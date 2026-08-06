import { PrismaService } from '@database/prisma.service';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PaymentGateway, PaymentStatus } from '@prisma/client';
import { AuditService } from '@shared/services/audit.service';
import { LoggerService } from '@shared/services/logger.service';

import { CreatePaymentDto } from './dto/create-payment.dto';
import { QueryPaymentDto } from './dto/query-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { VerifyRazorpayPaymentDto } from './dto/verify-payment.dto';
import { RazorpayGateway } from './gateways/razorpay.gateway';
import { StripeGateway } from './gateways/stripe.gateway';
import { InvoiceGenerator } from './invoice.generator';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly logger: LoggerService,
    private readonly razorpay: RazorpayGateway,
    private readonly stripe: StripeGateway,
    private readonly invoiceGenerator: InvoiceGenerator,
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

  async findOne(id: string, gymId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id, gymId },
      include: { member: true, membership: true, collectedBy: { select: { id: true, firstName: true, lastName: true } } },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    return payment;
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

    return this.prisma.payment.findFirst({ where: { id: paymentId } });
  }

  async downloadReceipt(id: string, gymId: string): Promise<Buffer> {
    const payment = await this.findOne(id, gymId);
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
