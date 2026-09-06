import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@database/prisma.service';
import { AuditService } from '@shared/services/audit.service';
import { LoggerService } from '@shared/services/logger.service';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { SequenceService } from '@shared/services/sequence.service';

import { PaymentsService } from './payments.service';
import { RazorpayGateway } from './gateways/razorpay.gateway';
import { StripeGateway } from './gateways/stripe.gateway';
import { InvoiceGenerator } from './invoice.generator';

describe('PaymentsService — verifyRazorpay & refund ledger reconciliation', () => {
  let service: PaymentsService;
  let prisma: any;
  let razorpay: any;
  let audit: any;

  const gymId = 'gym-1';
  const paymentId = 'pay-123';

  beforeEach(async () => {
    prisma = {
      payment: {
        findFirst: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      membershipMonth: {
        update: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(1),
      },
      membership: {
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      paymentMonthAllocation: {
        findMany: jest.fn().mockResolvedValue([]),
        delete: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };

    razorpay = {
      verifySignature: jest.fn(),
      fetchPayment: jest.fn(),
      refund: jest.fn(),
    };

    audit = {
      log: jest.fn(),
      logTx: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: LoggerService, useValue: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } },
        { provide: RazorpayGateway, useValue: razorpay },
        { provide: StripeGateway, useValue: { refund: jest.fn() } },
        { provide: InvoiceGenerator, useValue: { generate: jest.fn().mockResolvedValue(Buffer.from('pdf')) } },
        { provide: NotificationsService, useValue: { send: jest.fn().mockResolvedValue(undefined) } },
        { provide: SequenceService, useValue: { next: jest.fn().mockResolvedValue(1) } },
      ],
    }).compile();

    service = module.get(PaymentsService);
  });

  describe('verifyRazorpay', () => {
    const validDto = {
      paymentId,
      razorpayOrderId: 'order_123',
      razorpayPaymentId: 'pay_rzp_456',
      razorpaySignature: 'valid_signature',
    };

    it('returns existing payment if already COMPLETED without re-verifying', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        id: paymentId,
        gymId,
        gateway: 'RAZORPAY',
        status: 'COMPLETED',
        total: 1000,
        member: null,
      });

      const result = await service.verifyRazorpay(validDto, gymId);
      expect(result).toBeDefined();
      expect(razorpay.verifySignature).not.toHaveBeenCalled();
      expect(razorpay.fetchPayment).not.toHaveBeenCalled();
    });

    it('fails if signature verification fails', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        id: paymentId,
        gymId,
        gateway: 'RAZORPAY',
        gatewayOrderId: 'order_123',
        status: 'PENDING',
        total: 1000,
        member: null,
      });
      razorpay.verifySignature.mockReturnValue(false);

      await expect(service.verifyRazorpay(validDto, gymId)).rejects.toThrow(BadRequestException);
      expect(prisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'FAILED' } }),
      );
    });

    it('fails if Razorpay API returns amount mismatch', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        id: paymentId,
        gymId,
        gateway: 'RAZORPAY',
        gatewayOrderId: 'order_123',
        status: 'PENDING',
        total: 1000, // 100000 paise
        member: null,
      });
      razorpay.verifySignature.mockReturnValue(true);
      razorpay.fetchPayment.mockResolvedValue({
        order_id: 'order_123',
        amount: 50000, // mismatch: 50000 paise instead of 100000
        currency: 'INR',
        status: 'captured',
      });

      await expect(service.verifyRazorpay(validDto, gymId)).rejects.toThrow('Payment amount mismatch');
    });

    it('authoritatively completes payment, allocates months, and activates membership on success', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        id: paymentId,
        gymId,
        gateway: 'RAZORPAY',
        gatewayOrderId: 'order_123',
        status: 'PENDING',
        total: 1000,
        membershipId: 'mem-1',
        member: { id: 'm-1', firstName: 'John', lastName: 'Doe' },
        gym: { name: 'Muscle Gym' },
      });
      razorpay.verifySignature.mockReturnValue(true);
      razorpay.fetchPayment.mockResolvedValue({
        order_id: 'order_123',
        amount: 100000,
        currency: 'INR',
        status: 'captured',
      });
      prisma.paymentMonthAllocation.findMany.mockResolvedValue([
        { id: 'alloc-1', membershipMonthId: 'month-1' },
      ]);

      const result = await service.verifyRazorpay(validDto, gymId);

      expect(prisma.payment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: paymentId, status: 'PENDING' },
          data: expect.objectContaining({ status: 'COMPLETED', gatewayPaymentId: 'pay_rzp_456' }),
        }),
      );
      expect(prisma.membershipMonth.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'month-1' },
          data: { status: 'PAID', paymentId },
        }),
      );
      expect(prisma.membership.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'mem-1', status: 'PENDING' },
          data: { status: 'ACTIVE' },
        }),
      );
      expect(audit.logTx).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ action: 'UPDATE', entity: 'Payment', entityId: paymentId }),
      );
      expect(result).toBeDefined();
    });
  });

  describe('refund reconciliation', () => {
    it('rejects refund if payment is not completed', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        id: paymentId,
        gymId,
        status: 'PENDING',
        total: 1000,
        refundedAmount: 0,
        monthAllocations: [],
      });

      await expect(service.refund(paymentId, gymId, { reason: 'Test' }, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects refund exceeding remaining balance', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        id: paymentId,
        gymId,
        status: 'COMPLETED',
        total: 1000,
        refundedAmount: 500,
        monthAllocations: [],
      });

      await expect(
        service.refund(paymentId, gymId, { amount: 600, reason: 'Too much' }, 'user-1'),
      ).rejects.toThrow('Refund amount cannot exceed the remaining refundable balance');
    });

    it('reconciles month allocations in LIFO order and cancels membership if all paid months refunded', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        id: paymentId,
        gymId,
        status: 'COMPLETED',
        gateway: 'CASH',
        total: 2000,
        refundedAmount: 0,
        membershipId: 'mem-1',
        monthAllocations: [
          {
            id: 'alloc-1',
            membershipMonthId: 'month-1',
            amount: 1000,
            membershipMonth: { monthStart: new Date('2026-05-01') },
          },
          {
            id: 'alloc-2',
            membershipMonthId: 'month-2',
            amount: 1000,
            membershipMonth: { monthStart: new Date('2026-06-01') }, // later month, should be refunded first
          },
        ],
      });
      prisma.payment.findUniqueOrThrow.mockResolvedValue({
        id: paymentId,
        status: 'REFUNDED',
        refundedAmount: 2000,
      });
      // After full refund, 0 paid months remain
      prisma.membershipMonth.count.mockResolvedValue(0);

      const result = await service.refund(paymentId, gymId, { reason: 'Member moved away' }, 'user-1');

      // Month 2 (alloc-2) refunded first (LIFO)
      expect(prisma.paymentMonthAllocation.delete).toHaveBeenCalledWith({ where: { id: 'alloc-2' } });
      expect(prisma.membershipMonth.update).toHaveBeenCalledWith({
        where: { id: 'month-2' },
        data: { status: 'PAYABLE', paymentId: null },
      });

      // Month 1 (alloc-1) refunded second
      expect(prisma.paymentMonthAllocation.delete).toHaveBeenCalledWith({ where: { id: 'alloc-1' } });
      expect(prisma.membershipMonth.update).toHaveBeenCalledWith({
        where: { id: 'month-1' },
        data: { status: 'PAYABLE', paymentId: null },
      });

      // Membership cancelled
      expect(prisma.membership.update).toHaveBeenCalledWith({
        where: { id: 'mem-1' },
        data: { status: 'CANCELLED' },
      });

      expect(audit.logTx).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({ action: 'REFUND', entity: 'Payment', entityId: paymentId }),
      );
      expect(result.status).toBe('REFUNDED');
    });

    it('handles partial refund by adjusting allocation and setting month amountDue', async () => {
      prisma.payment.findFirst.mockResolvedValue({
        id: paymentId,
        gymId,
        status: 'COMPLETED',
        gateway: 'CASH',
        total: 1000,
        refundedAmount: 0,
        membershipId: 'mem-1',
        monthAllocations: [
          {
            id: 'alloc-1',
            membershipMonthId: 'month-1',
            amount: 1000,
            membershipMonth: { monthStart: new Date('2026-05-01') },
          },
        ],
      });
      prisma.payment.findUniqueOrThrow.mockResolvedValue({
        id: paymentId,
        status: 'PARTIALLY_REFUNDED',
        refundedAmount: 400,
      });
      prisma.membershipMonth.count.mockResolvedValue(1);

      const result = await service.refund(paymentId, gymId, { amount: 400, reason: 'Partial discount' }, 'user-1');

      expect(prisma.paymentMonthAllocation.update).toHaveBeenCalledWith({
        where: { id: 'alloc-1' },
        data: { amount: 600 }, // 1000 - 400
      });
      expect(prisma.membershipMonth.update).toHaveBeenCalledWith({
        where: { id: 'month-1' },
        data: { amountDue: 400, status: 'PAYABLE' },
      });
      expect(result.status).toBe('PARTIALLY_REFUNDED');
    });
  });
});
