import { PrismaService } from '@database/prisma.service';
import { BadRequestException, Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PaymentGateway, PaymentMethod, PaymentStatus, Prisma } from '@prisma/client';
import { AuditService } from '@shared/services/audit.service';
import { LoggerService } from '@shared/services/logger.service';

import { CreatePaymentDto } from './dto/create-payment.dto';
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
  ) {}

  private async nextSequence(gymId: string, prefix: 'RCPT' | 'INV') {
    const count = await this.prisma.payment.count({ where: { gymId } });
    const year = new Date().getFullYear();
    return `${prefix}-${year}-${String(count + 1).padStart(5, '0')}`;
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
   * Member self-pay ("Pay Now" on MyMembershipPage) â€” deliberately a
   * separate, narrow entry point rather than exposing the generic
   * initiate() to MEMBER role directly. The generic one trusts
   * dto.amount/memberId/membershipId from the client, which would let a
   * member pay an arbitrary (e.g. â‚¹1) amount for their real membership, or
   * name someone else's memberId. Here, membershipId is the only client
   * input; amount and memberId are both derived server-side from the
   * membership row itself, and ownership is checked via the same
   * Member.userId identity chain used everywhere else this session.
   */
  async initiateSelfPay(gymId: string, userId: string, membershipId: string, gateway: PaymentGateway, method: PaymentMethod) {
    const member = await this.prisma.member.findFirst({ where: { userId, gymId, deletedAt: null } });
    if (!member) {
      throw new NotFoundException('No member profile is linked to this account yet â€” ask staff to link your profile.');
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

  /** Members may only reach their own payment/receipt â€” this is the
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

  /** Member's own payment history â€” identity resolved via Member.userId, never email/mobile matching. */
  async findMine(gymId: string, userId: string) {
    const member = await this.prisma.member.findFirst({ where: { userId, gymId, deletedAt: null } });
    if (!member) {
      throw new NotFoundException('No member profile is linked to this account yet â€” ask staff to link your profile.');
    }
    return this.prisma.payment.findMany({
      where: { memberId: member.id, gymId },
      orderBy: { createdAt: 'desc' },
      include: { membership: { select: { id: true, planName: true } } },
    });
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
      // offline payment already marked completed â€” generate receipt immediately
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
   *  two webhook deliveries racing each other can't both slip through â€”
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
        content: `Hi ${payment.member.firstName}, we received your payment of ₹${Number(payment.total).toFixed(2)}. Receipt #${payment.receiptNumber}. Thank you!`,
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
      // Also blocks a second refund attempt outright â€” once PARTIALLY_REFUNDED
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
}
