import { PrismaService } from '@database/prisma.service';
import { BadRequestException, Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PaymentGateway, PaymentMethod, PaymentStatus, Prisma } from '@prisma/client';
import { AuditService } from '@shared/services/audit.service';
import { LoggerService } from '@shared/services/logger.service';
import { SequenceService } from '@shared/services/sequence.service';

import { CreatePaymentDto } from './dto/create-payment.dto';
import { AllocateMonthsDto } from './dto/allocate-months.dto';
import { QueryPaymentDto } from './dto/query-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { VerifyRazorpayPaymentDto } from './dto/verify-payment.dto';
import { RazorpayGateway } from './gateways/razorpay.gateway';
import { StripeGateway } from './gateways/stripe.gateway';
import { InvoiceGenerator } from './invoice.generator';
import { NotificationsService } from '@modules/notifications/notifications.service';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly logger: LoggerService,
    private readonly razorpay: RazorpayGateway,
    private readonly stripe: StripeGateway,
    private readonly invoiceGenerator: InvoiceGenerator,
    private readonly notifications: NotificationsService,
    private readonly sequence: SequenceService,
  ) {}

  private async nextSequence(gymId: string, prefix: 'RCPT' | 'INV') {
    // Atomic per-gym, per-scope counter (scoped by prefix+year so receipt
    // and invoice numbers each get their own yearly sequence) -- immune to
    // the count()+1 race where two simultaneous payments could otherwise
    // be issued the same receipt/invoice number.
    const year = new Date().getFullYear();
    const next = await this.sequence.next(gymId, `${prefix}-${year}`);
    return `${prefix}-${year}-${String(next).padStart(5, '0')}`;
  }

  private calculateTotals(amount: number, discount = 0, gstPercentage = 0) {
    const discounted = Math.max(amount - discount, 0);
    const tax = Number(((discounted * gstPercentage) / 100).toFixed(2));
    const total = Number((discounted + tax).toFixed(2));
    return { tax, total };
  }

  async findAll(gymId: string, query: QueryPaymentDto) {
    const { page = 1, limit = 20, search, status, gateway, fromDate, toDate } = query;
    const skip = (page - 1) * limit;
    const where: any = { gymId, deletedAt: null };
    if (status) where.status = status;
    if (gateway) where.gateway = gateway;
    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = new Date(fromDate);
      if (toDate) where.createdAt.lte = new Date(toDate);
    }
    if (search) {
      where.OR = [
        { receiptNumber: { contains: search, mode: 'insensitive' } },
        { invoiceNumber: { contains: search, mode: 'insensitive' } },
        { member: { firstName: { contains: search, mode: 'insensitive' } } },
      ];
    }
    const [data, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { member: { select: { id: true, firstName: true, lastName: true, mobile: true } }, collectedBy: { select: { id: true, firstName: true, lastName: true } } },
      }),
      this.prisma.payment.count({ where }),
    ]);
    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit), hasNextPage: page * limit < total, hasPrevPage: page > 1 },
    };
  }

  /**
   * Member self-pay ("Pay Now" on MyMembershipPage) — deliberately a
   * separate, narrow entry point rather than exposing the generic
   * initiate() to MEMBER role directly. The generic one trusts
   * dto.amount/memberId/membershipId from the client, which would let a
   * member pay an arbitrary (e.g. ₹1) amount for their real membership, or
   * name someone else's memberId. Here, membershipId is the only client
   * input; amount and memberId are both derived server-side from the
   * membership row itself, and ownership is checked via the same
   * Member.userId identity chain used everywhere else this session.
   */
  async initiateSelfPay(gymId: string, userId: string, membershipId: string, gateway: PaymentGateway, method: PaymentMethod) {
    const member = await this.prisma.member.findFirst({ where: { userId, gymId, deletedAt: null } });
    if (!member) {
      throw new NotFoundException('No member profile is linked to this account yet — ask staff to link your profile.');
    }
    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId, memberId: member.id, gymId },
    });
    if (!membership) {
      throw new NotFoundException('Membership not found, or it does not belong to your account.');
    }
    const alreadyPaid = await this.prisma.payment.findFirst({
      where: { membershipId: membership.id, status: PaymentStatus.COMPLETED },
    });
    if (alreadyPaid) {
      throw new BadRequestException('This membership is already paid.');
    }

    return this.initiate(
      {
        amount: Number(membership.baseAmount),
        discount: Number(membership.discountAmount ?? 0),
        gstPercentage: undefined,
        gateway,
        method,
        memberId: member.id,
        membershipId: membership.id,
        notes: 'Self-service payment via member PWA',
      } as CreatePaymentDto,
      gymId,
      userId,
    );
  }

  async findOne(id: string, gymId: string, requester?: { userId: string; role: string }) {
    const payment = await this.prisma.payment.findFirst({
      where: { id, gymId },
      include: { member: true, membership: true, collectedBy: { select: { id: true, firstName: true, lastName: true } } },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    await this.assertCanView(payment, requester);
    return payment;
  }

  /** Members may only reach their own payment/receipt — this is the
   *  ownership check the plain gymId scoping above doesn't provide, since
   *  gymId scoping alone still lets any member in the gym see any other
   *  member's payment by id. */
  private async assertCanView(payment: { memberId: string | null }, requester?: { userId: string; role: string }) {
    if (!requester || requester.role !== 'MEMBER') return; // staff already gated by @Roles on other endpoints; this fn only tightens the member case
    const member = await this.prisma.member.findFirst({ where: { userId: requester.userId } });
    if (!member || member.id !== payment.memberId) {
      throw new ForbiddenException('You can only view your own payments');
    }
  }

  /** Member's own payment history — identity resolved via Member.userId, never email/mobile matching. */
  async findMine(gymId: string, userId: string, page = 1, limit = 20) {
    const member = await this.prisma.member.findFirst({ where: { userId, gymId, deletedAt: null } });
    if (!member) {
      throw new NotFoundException('No member profile is linked to this account yet — ask staff to link your profile.');
    }
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safePage = Math.max(page, 1);
    const where = { memberId: member.id, gymId };
    const [data, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { membership: { select: { id: true, planName: true } } },
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
      }),
      this.prisma.payment.count({ where }),
    ]);
    return { data, total, page: safePage, limit: safeLimit };
  }

  /** Member's own payable/locked months for one of THEIR OWN memberships — ownership is
   *  verified via Member.userId before any month rows are returned, so a member can never
   *  probe another member's membershipId to see what they owe. */
  async getPayableMonths(gymId: string, userId: string, membershipId: string) {
    const member = await this.prisma.member.findFirst({ where: { userId, gymId, deletedAt: null } });
    if (!member) {
      throw new NotFoundException('No member profile is linked to this account yet — ask staff to link your profile.');
    }
    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId, gymId, memberId: member.id },
    });
    if (!membership) {
      throw new NotFoundException('Membership not found');
    }
    const months = await this.prisma.membershipMonth.findMany({
      where: { membershipId, status: { in: ['PAYABLE', 'PENDING'] } },
      orderBy: { monthStart: 'asc' },
    });
    return months.map((m) => ({
      monthStart: m.monthStart,
      amountDue: m.amountDue,
      status: m.status,
    }));
  }
  /** Staff/owner view of ALL months (any status) for a membership, gym-scoped
   *  only (not member-owned) -- used by the "record manual payment" screen. */
  async getMembershipMonthsForStaff(gymId: string, membershipId: string) {
    const membership = await this.prisma.membership.findFirst({ where: { id: membershipId, gymId } });
    if (!membership) throw new NotFoundException('Membership not found in this gym.');

    const months = await this.prisma.membershipMonth.findMany({
      where: { membershipId },
      orderBy: { monthStart: 'asc' },
    });
    return months.map((m) => ({ id: m.id, monthStart: m.monthStart, amountDue: m.amountDue, status: m.status }));
  }

  /** Step 1: create a pending payment record + gateway order for online payments. */
  async initiate(dto: CreatePaymentDto, gymId: string, collectedById: string) {
    const { tax, total } = this.calculateTotals(dto.amount, dto.discount ?? 0, dto.gstPercentage ?? 0);
    const receiptNumber = await this.nextSequence(gymId, 'RCPT');

    const payment = await this.prisma.payment.create({
      data: {
        amount: dto.amount,
        discount: dto.discount ?? 0,
        tax,
        total,
        gateway: dto.gateway,
        method: dto.method,
        gstPercentage: dto.gstPercentage,
        gstNumber: dto.gstNumber,
        memberId: dto.memberId,
        membershipId: dto.membershipId,
        collectedById,
        notes: dto.notes,
        receiptNumber,
        status: dto.gateway === PaymentGateway.CASH || dto.gateway === PaymentGateway.BANK_TRANSFER || dto.gateway === PaymentGateway.UPI
          ? PaymentStatus.COMPLETED
          : PaymentStatus.PENDING,
        gymId,
        verifiedAt:
          dto.gateway === PaymentGateway.CASH || dto.gateway === PaymentGateway.BANK_TRANSFER || dto.gateway === PaymentGateway.UPI
            ? new Date()
            : null,
      },
    });

    let gatewayOrder: any = null;
    if (dto.gateway === PaymentGateway.RAZORPAY) {
      gatewayOrder = await this.razorpay.createOrder(Math.round(total * 100), 'INR', receiptNumber, { paymentId: payment.id, gymId });
      await this.prisma.payment.update({ where: { id: payment.id }, data: { gatewayOrderId: gatewayOrder.id } });
    } else if (dto.gateway === PaymentGateway.STRIPE) {
      gatewayOrder = await this.stripe.createPaymentIntent(Math.round(total * 100), 'usd', { paymentId: payment.id, gymId });
      await this.prisma.payment.update({ where: { id: payment.id }, data: { gatewayOrderId: gatewayOrder.id } });
    } else {
      // offline payment already marked completed — generate receipt immediately
      await this.finalizeReceipt(payment.id, gymId);
    }

    await this.audit.log({ action: 'CREATE', entity: 'Payment', entityId: payment.id, newValue: payment, gymId, userId: collectedById });
    return { payment, gatewayOrder };
  }

  /** Step 2 (Razorpay only): client posts checkout signature for server-side verification. */
  async verifyRazorpay(dto: VerifyRazorpayPaymentDto, gymId: string) {
    const payment = await this.findOne(dto.paymentId, gymId);
    if (payment.gateway !== PaymentGateway.RAZORPAY) {
      throw new BadRequestException('Payment was not initiated via Razorpay');
    }
    const valid = this.razorpay.verifySignature(dto.razorpayOrderId, dto.razorpayPaymentId, dto.razorpaySignature);
    if (!valid) {
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.FAILED } });
      throw new BadRequestException('Payment signature verification failed');
    }
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.COMPLETED, gatewayPaymentId: dto.razorpayPaymentId, verifiedAt: new Date() },
    });
    return this.finalizeReceipt(payment.id, gymId);
  }

  /** Atomic idempotency check: returns true the FIRST time a given
   *  (provider, eventId) is seen, false on every replay. The unique
   *  constraint (not a prior SELECT) is what actually enforces this, so
   *  two webhook deliveries racing each other can't both slip through —
   *  whichever loses the DB-level race gets the P2002 and is treated as
   *  a duplicate rather than reprocessed. */
  async recordWebhookEventOnce(provider: string, eventId: string, eventType: string, payload: any): Promise<boolean> {
    try {
      await this.prisma.webhookEvent.create({
        data: { provider, eventId, eventType, payload },
      });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        this.logger.warn(`Duplicate webhook ignored: ${provider}/${eventId}`, 'PaymentsService');
        return false;
      }
      throw error;
    }
  }

  /** Called by webhook handlers once a gateway confirms payment async. */
  async markCompletedFromWebhook(gatewayOrderId: string, gatewayPaymentId: string, webhookData: any) {
    const payment = await this.prisma.payment.findFirst({ where: { gatewayOrderId } });
    if (!payment) {
      this.logger.warn(`Webhook received for unknown gatewayOrderId=${gatewayOrderId}`, 'PaymentsService');
      return null;
    }
    if (payment.status === PaymentStatus.COMPLETED) return payment;
    await this.prisma.payment.update({
      where: { id: payment.id },
      data: { status: PaymentStatus.COMPLETED, gatewayPaymentId, webhookData, verifiedAt: new Date() },
    });
    return this.finalizeReceipt(payment.id, payment.gymId);
  }

  async markFailedFromWebhook(gatewayOrderId: string, webhookData: any) {
    const payment = await this.prisma.payment.findFirst({ where: { gatewayOrderId } });
    if (!payment) return null;
    return this.prisma.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.FAILED, webhookData } });
  }

  /** Generates the invoice number + PDF once a payment is confirmed COMPLETED. */
  private async finalizeReceipt(paymentId: string, gymId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId },
      include: { member: true, gym: true, collectedBy: true },
    });
    if (!payment || payment.invoiceNumber) return payment;

    const invoiceNumber = await this.nextSequence(gymId, 'INV');
    await this.prisma.payment.update({ where: { id: paymentId }, data: { invoiceNumber } });

    try {
      await this.invoiceGenerator.generate({
        invoiceNumber,
        receiptNumber: payment.receiptNumber ?? invoiceNumber,
        date: payment.createdAt,
        gymName: payment.gym.name,
        gymAddress: payment.gym.address ?? undefined,
        gymGstNumber: payment.gym.gstNumber ?? undefined,
        memberName: payment.member ? `${payment.member.firstName} ${payment.member.lastName}` : 'Walk-in',
        memberPhone: payment.member?.mobile ?? undefined,
        description: 'Gym Membership Payment',
        amount: Number(payment.amount),
        discount: Number(payment.discount),
        gstPercentage: payment.gstPercentage ? Number(payment.gstPercentage) : undefined,
        tax: Number(payment.tax),
        total: Number(payment.total),
        method: payment.method,
        collectedBy: payment.collectedBy ? `${payment.collectedBy.firstName} ${payment.collectedBy.lastName}` : undefined,
      });
      // In production this buffer is uploaded to S3/GCS and invoiceUrl set to the public URL.
    } catch (err) {
      this.logger.error(`Invoice generation failed for payment ${paymentId}: ${err}`, undefined, 'PaymentsService');
    }

    // Best-effort — a failed WhatsApp send must never fail the payment
    // itself, which is why this comes after the invoice generation and is
    // caught independently rather than allowed to throw.
    if (payment.member) {
      this.notifications.send(gymId, {
        type: 'PAYMENT_SUCCESS' as any,
        channel: 'WHATSAPP' as any,
        memberId: payment.member.id,
        content: `Hi ${payment.member.firstName}, we received your payment of ?${Number(payment.total).toFixed(2)}. Receipt #${payment.receiptNumber}. Thank you!`,
        title: 'Payment received',
      } as any).catch(() => undefined);
    }

    return this.prisma.payment.findFirst({ where: { id: paymentId } });
  }

  async downloadReceipt(id: string, gymId: string, requester?: { userId: string; role: string }): Promise<Buffer> {
    const payment = await this.findOne(id, gymId, requester);
    if (payment.status !== PaymentStatus.COMPLETED) {
      throw new BadRequestException('Receipt is only available for completed payments');
    }
    const gym = await this.prisma.gym.findUnique({ where: { id: gymId } });
    if (!gym) throw new NotFoundException('Gym not found');
    return this.invoiceGenerator.generate({
      invoiceNumber: payment.invoiceNumber ?? payment.receiptNumber ?? id,
      receiptNumber: payment.receiptNumber ?? id,
      date: payment.createdAt,
      gymName: gym.name,
      gymAddress: gym.address ?? undefined,
      gymGstNumber: gym.gstNumber ?? undefined,
      memberName: (payment).member ? `${(payment).member.firstName} ${(payment).member.lastName}` : 'Walk-in',
      memberPhone: (payment).member?.mobile ?? undefined,
      description: 'Gym Membership Payment',
      amount: Number(payment.amount),
      discount: Number(payment.discount),
      gstPercentage: payment.gstPercentage ? Number(payment.gstPercentage) : undefined,
      tax: Number(payment.tax),
      total: Number(payment.total),
      method: payment.method,
      collectedBy: (payment).collectedBy ? `${(payment).collectedBy.firstName} ${(payment).collectedBy.lastName}` : undefined,
    });
  }

  async refund(id: string, gymId: string, dto: RefundPaymentDto, userId: string) {
    const payment = await this.findOne(id, gymId);
    if (payment.status !== PaymentStatus.COMPLETED) {
      // Also blocks a second refund attempt outright — once PARTIALLY_REFUNDED
      // or REFUNDED, status is no longer COMPLETED, so a duplicate/retried
      // refund request can't silently double-refund on the gateway side.
      throw new BadRequestException('Only completed payments can be refunded');
    }
    const refundAmount = dto.amount ?? Number(payment.total);
    if (refundAmount > Number(payment.total)) {
      throw new BadRequestException('Refund amount cannot exceed the paid amount');
    }

    if (payment.gateway === PaymentGateway.RAZORPAY && payment.gatewayPaymentId) {
      await this.razorpay.refund(payment.gatewayPaymentId, Math.round(refundAmount * 100));
    } else if (payment.gateway === PaymentGateway.STRIPE && payment.gatewayPaymentId) {
      await this.stripe.refund(payment.gatewayPaymentId, Math.round(refundAmount * 100));
    }
    // Cash/UPI/bank-transfer refunds are recorded but must be settled manually.

    const isFullRefund = refundAmount >= Number(payment.total);
    const updated = await this.prisma.payment.update({
      where: { id },
      data: { status: isFullRefund ? PaymentStatus.REFUNDED : PaymentStatus.PARTIALLY_REFUNDED, notes: `${payment.notes ?? ''}\nRefund: ${dto.reason}`.trim() },
    });

    await this.audit.log({ action: 'REFUND', entity: 'Payment', entityId: id, oldValue: payment, newValue: updated, gymId, userId });
    return updated;
  }

  async summary(gymId: string, fromDate?: string, toDate?: string) {
    const where: any = { gymId, status: PaymentStatus.COMPLETED, deletedAt: null };
    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = new Date(fromDate);
      if (toDate) where.createdAt.lte = new Date(toDate);
    }
    const [totals, pendingCount, failedCount, refundedCount] = await Promise.all([
      this.prisma.payment.aggregate({ where, _sum: { total: true, tax: true, discount: true }, _count: true }),
      this.prisma.payment.count({ where: { gymId, status: PaymentStatus.PENDING } }),
      this.prisma.payment.count({ where: { gymId, status: PaymentStatus.FAILED } }),
      this.prisma.payment.count({ where: { gymId, status: { in: [PaymentStatus.REFUNDED, PaymentStatus.PARTIALLY_REFUNDED] } } }),
    ]);
    return {
      totalRevenue: totals._sum.total ?? 0,
      totalTax: totals._sum.tax ?? 0,
      totalDiscount: totals._sum.discount ?? 0,
      completedCount: totals._count,
      pendingCount,
      failedCount,
      refundedCount,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Direct-to-owner UPI payments — no payment gateway needed. The gym  */
  /* owner sets their own UPI ID once; every member payment goes       */
  /* straight into the owner's own bank account (standard UPI person-  */
  /* to-merchant transfer, zero platform fees). Since there's no       */
  /* gateway API in the loop, there's no automatic webhook confirming  */
  /* the transfer — the member reports the UTR reference after paying,*/
  /* and staff/owner confirms it against their own bank/UPI app.       */
  /* ---------------------------------------------------------------- */

  async getUpiDetails(gymId: string) {
    const rows = await this.prisma.gymSetting.findMany({ where: { gymId, category: 'payment_upi' } });
    const settings: Record<string, string> = {};
    for (const row of rows) settings[row.key] = row.value;
    return {
      configured: !!settings.upiId,
      upiId: settings.upiId ?? null,
      payeeName: settings.payeeName ?? null,
    };
  }

  /** Builds the standard UPI deep-link (`upi://pay?...`) for a given
   *  amount — tapping it on a phone opens whichever UPI app the member
   *  has installed (GPay, PhonePe, Paytm, etc.) with the amount and payee
   *  pre-filled, so they don't have to type anything by hand. Also
   *  returns a QR-code PNG (data URL) of the same link, for members
   *  paying from a kiosk/desktop rather than their own phone. */
  private async priceMonths(gymId: string, membershipId: string, monthStarts: string[]) {
    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId, gymId, deletedAt: null },
    });
    if (!membership) throw new NotFoundException('Membership not found in this gym.');

    const requestedStarts = monthStarts.map((d) => new Date(d)).sort((a, b) => a.getTime() - b.getTime());
    const months = await this.prisma.membershipMonth.findMany({
      where: { membershipId, monthStart: { in: requestedStarts } },
      orderBy: { monthStart: 'asc' },
    });

    if (months.length !== requestedStarts.length) {
      throw new BadRequestException('One or more requested months do not exist for this membership.');
    }
    if (months.some((m) => m.status === 'PAID')) {
      throw new BadRequestException('One or more selected months are already paid.');
    }
    if (months.some((m) => m.status === 'PENDING')) {
      throw new BadRequestException('One or more selected months already have a pending verification.');
    }

    const earlierUnpaid = await this.prisma.membershipMonth.count({
      where: { membershipId, monthStart: { lt: requestedStarts[0] }, status: { not: 'PAID' } },
    });
    if (earlierUnpaid > 0) {
      throw new BadRequestException('Cannot pay this month while an earlier month is still unpaid.');
    }

    for (let i = 1; i < months.length; i++) {
      const prev = new Date(months[i - 1].monthStart);
      const expectedNext = new Date(prev.getFullYear(), prev.getMonth() + 1, 1);
      if (new Date(months[i].monthStart).getTime() !== expectedNext.getTime()) {
        throw new BadRequestException('Selected months must be consecutive.');
      }
    }

    const totalAmount = months.reduce((sum, m) => sum + Number(m.amountDue), 0);
    return { membership, months, totalAmount };
  }

  private async assertOwnMembership(gymId: string, userId: string, membershipId: string) {
    const member = await this.prisma.member.findFirst({ where: { userId, gymId } });
    if (!member) throw new NotFoundException('No member profile found for this account in this gym.');
    const membership = await this.prisma.membership.findFirst({ where: { id: membershipId, gymId, memberId: member.id } });
    if (!membership) throw new ForbiddenException('This membership does not belong to your account.');
    return member;
  }

  async buildUpiPaymentLink(gymId: string, userId: string, membershipId: string, monthStarts: string[], note: string) {
    await this.assertOwnMembership(gymId, userId, membershipId);
    const { totalAmount } = await this.priceMonths(gymId, membershipId, monthStarts);

    const details = await this.getUpiDetails(gymId);
    if (!details.configured || !details.upiId) {
      throw new BadRequestException('This gym has not set up direct UPI payments yet.');
    }
    const params = new URLSearchParams({
      pa: details.upiId,
      pn: details.payeeName || 'Gym',
      am: totalAmount.toFixed(2),
      cu: 'INR',
      tn: note,
    });
    const link = `upi://pay?${params.toString()}`;

    const QRCode = require('qrcode');
    const qrDataUrl: string = await QRCode.toDataURL(link, { width: 300, margin: 1 });

    return { link, qrDataUrl, upiId: details.upiId, payeeName: details.payeeName, amount: totalAmount };
  }

  /** Member says "I've paid" and provides the UTR/reference number their
   *  UPI app showed them — creates a PENDING payment row. Nothing is
   *  auto-confirmed here on purpose: a member typing in a UTR is not
   *  proof of payment by itself (they could type a fake or someone
   *  else's), so this must be verified by staff/owner before it counts. */
  async submitUpiClaim(gymId: string, userId: string, membershipId: string, monthStarts: string[], utrReference: string) {
    const member = await this.assertOwnMembership(gymId, userId, membershipId);
    if (!utrReference || utrReference.trim().length < 4) {
      throw new BadRequestException('Enter the UTR / reference number shown in your UPI app after paying.');
    }

    const { months, totalAmount } = await this.priceMonths(gymId, membershipId, monthStarts);
    const receiptNumber = await this.nextSequence(gymId, 'RCPT');
    const { tax, total } = this.calculateTotals(totalAmount);

    const payment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          amount: totalAmount, tax, total, discount: 0,
          gateway: PaymentGateway.UPI,
          method: PaymentMethod.UPI,
          source: 'ONLINE',
          utr: utrReference.trim(),
          status: PaymentStatus.PENDING,
          memberId: member.id,
          membershipId,
          receiptNumber,
          notes: 'Direct UPI payment — pending owner/staff verification',
          gymId,
        },
      });
      for (const month of months) {
        await tx.paymentMonthAllocation.create({
          data: { paymentId: created.id, membershipMonthId: month.id, amount: month.amountDue },
        });
        await tx.membershipMonth.update({ where: { id: month.id }, data: { status: 'PENDING', paymentId: created.id } });
      }
      return created;
    });

    await this.audit.log({
      action: 'UPI_CLAIM_SUBMITTED', entity: 'Payment', entityId: payment.id, userId, gymId,
      newValue: { amount: totalAmount, utrReference, monthStarts },
    });

    return payment;
  }

  /** Staff/owner-side list of UPI claims awaiting verification. */
  async listPendingUpiClaims(gymId: string) {
    return this.prisma.payment.findMany({
      where: { gymId, gateway: PaymentGateway.UPI, status: PaymentStatus.PENDING },
      include: {
        member: { select: { firstName: true, lastName: true, mobile: true } },
        membership: { select: { planName: true } },
        monthAllocations: { include: { membershipMonth: { select: { monthStart: true } } }, orderBy: { membershipMonth: { monthStart: 'asc' } } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Staff/owner checked their own bank/UPI app, saw the matching UTR
   *  actually landed, and confirms it here — only then does it count as
   *  a real completed payment (receipt generated, WhatsApp sent). */
  async confirmUpiClaim(id: string, gymId: string, staffUserId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id, gymId, gateway: PaymentGateway.UPI },
      include: { monthAllocations: true },
    });
    if (!payment) throw new NotFoundException('UPI payment claim not found');
    if (payment.status !== PaymentStatus.PENDING) {
      throw new BadRequestException(`This claim is already ${payment.status.toLowerCase()}.`);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id },
        data: { status: PaymentStatus.COMPLETED, verifiedAt: new Date(), verifiedById: staffUserId, collectedById: staffUserId },
      });
      for (const alloc of payment.monthAllocations) {
        await tx.membershipMonth.update({ where: { id: alloc.membershipMonthId }, data: { status: 'PAID', paymentId: id } });
      }
    });

    await this.audit.log({
      action: 'UPI_CLAIM_CONFIRMED', entity: 'Payment', entityId: id, userId: staffUserId, gymId,
    });

    const finalized = await this.finalizeReceipt(id, gymId);

    if (payment.memberId) {
      this.notifications.send(gymId, {
        type: 'PAYMENT_SUCCESS' as any,
        channel: 'WHATSAPP' as any,
        memberId: payment.memberId,
        content: `Hi, your payment of ?${Number(payment.total).toFixed(2)} has been confirmed. Receipt #${payment.receiptNumber}. Thank you!`,
        title: 'Payment confirmed',
      } as any).catch(() => undefined);
    }

    return finalized;
  }

  /** Staff/owner rejects a claim that doesn't check out (UTR doesn't
   *  match anything in their bank/UPI app, wrong amount, etc). */
  async rejectUpiClaim(id: string, gymId: string, staffUserId: string, reason?: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id, gymId, gateway: PaymentGateway.UPI },
      include: { monthAllocations: true },
    });
    if (!payment) throw new NotFoundException('UPI payment claim not found');
    if (payment.status !== PaymentStatus.PENDING) {
      throw new BadRequestException(`This claim is already ${payment.status.toLowerCase()}.`);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.payment.update({
        where: { id },
        data: { status: PaymentStatus.FAILED, notes: reason ? `Rejected: ${reason}` : 'Rejected by staff' },
      });
      for (const alloc of payment.monthAllocations) {
        await tx.membershipMonth.update({ where: { id: alloc.membershipMonthId }, data: { status: 'PAYABLE', paymentId: null } });
      }
      return u;
    });

    await this.audit.log({
      action: 'UPI_CLAIM_REJECTED', entity: 'Payment', entityId: id, userId: staffUserId, gymId,
      newValue: { reason },
    });

    return updated;
  }

  /**
   * Staff-recorded manual payment (cash / wall-QR UPI / bank transfer) that
   * covers one or more CONSECUTIVE unpaid months of a membership.
   */
  async recordManualPaymentWithMonths(
    gymId: string,
    staffUserId: string,
    dto: AllocateMonthsDto,
  ) {
    const membership = await this.prisma.membership.findFirst({
      where: { id: dto.membershipId, gymId, deletedAt: null },
    });
    if (!membership) throw new NotFoundException('Membership not found in this gym.');

    const requestedStarts = dto.monthStarts
      .map((d) => new Date(d))
      .sort((a, b) => a.getTime() - b.getTime());

    const months = await this.prisma.membershipMonth.findMany({
      where: { membershipId: dto.membershipId, monthStart: { in: requestedStarts } },
      orderBy: { monthStart: 'asc' },
    });

    if (months.length !== requestedStarts.length) {
      throw new BadRequestException('One or more requested months do not exist for this membership.');
    }
    if (months.some((m) => m.status === 'PAID')) {
      throw new BadRequestException('One or more selected months are already paid.');
    }
    if (months.some((m) => m.status === 'PENDING')) {
      throw new BadRequestException('One or more selected months already have a pending verification.');
    }

    const earliestRequested = requestedStarts[0];
    const earlierUnpaid = await this.prisma.membershipMonth.count({
      where: {
        membershipId: dto.membershipId,
        monthStart: { lt: earliestRequested },
        status: { not: 'PAID' },
      },
    });
    if (earlierUnpaid > 0) {
      throw new BadRequestException('Cannot pay this month while an earlier month is still unpaid.');
    }

    for (let i = 1; i < months.length; i++) {
      const prev = new Date(months[i - 1].monthStart);
      const expectedNext = new Date(prev.getFullYear(), prev.getMonth() + 1, 1);
      if (new Date(months[i].monthStart).getTime() !== expectedNext.getTime()) {
        throw new BadRequestException('Selected months must be consecutive.');
      }
    }

    const totalAmount = months.reduce((sum, m) => sum + Number(m.amountDue), 0);
    const isCash = dto.gateway === 'CASH';
    const status: PaymentStatus = isCash ? 'COMPLETED' : 'PENDING';
    const receiptNumber = isCash ? await this.nextSequence(gymId, 'RCPT') : null;

    const result = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          amount: totalAmount,
          discount: 0,
          tax: 0,
          total: totalAmount,
          gateway: dto.gateway,
          method: dto.method,
          source: 'STAFF',
          status,
          utr: dto.utr,
          receiptNumber,
          notes: dto.notes,
          memberId: membership.memberId,
          membershipId: membership.id,
          collectedById: staffUserId,
          verifiedById: isCash ? staffUserId : null,
          verifiedAt: isCash ? new Date() : null,
          gymId,
        },
      });

      for (const month of months) {
        await tx.paymentMonthAllocation.create({
          data: { paymentId: payment.id, membershipMonthId: month.id, amount: month.amountDue },
        });
        await tx.membershipMonth.update({
          where: { id: month.id },
          data: { status: isCash ? 'PAID' : 'PENDING', paymentId: payment.id },
        });
      }

      return payment;
    });

    this.logger.log(`Manual payment ${result.id} recorded for membership ${membership.id} (${status})`, 'PaymentsService');
    return result;
  }

  /**
   * Owner/staff verifies a PENDING wall-QR UPI submission.
   */
  async verifyManualPayment(gymId: string, paymentId: string, verifierUserId: string, approve: boolean) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, gymId, deletedAt: null },
      include: { monthAllocations: true },
    });
    if (!payment) throw new NotFoundException('Payment not found in this gym.');
    if (payment.status !== 'PENDING') {
      throw new BadRequestException('Only PENDING payments can be verified.');
    }

    const newStatus: PaymentStatus = approve ? 'COMPLETED' : 'FAILED';

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: paymentId },
        data: { status: newStatus, verifiedById: verifierUserId, verifiedAt: new Date() },
      });
      for (const alloc of payment.monthAllocations) {
        await tx.membershipMonth.update({
          where: { id: alloc.membershipMonthId },
          data: { status: approve ? 'PAID' : 'PAYABLE', paymentId: approve ? paymentId : null },
        });
      }
    });

    await this.audit.log({
      action: approve ? 'PAYMENT_VERIFIED' : 'PAYMENT_REJECTED',
      entity: 'Payment',
      entityId: paymentId,
      userId: verifierUserId,
      gymId,
    });

    return { id: paymentId, status: newStatus };
  }
}