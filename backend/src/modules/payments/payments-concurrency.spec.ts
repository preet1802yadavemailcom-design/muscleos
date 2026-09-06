import { BadRequestException, ConflictException } from '@nestjs/common';
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

describe('Payments & Financial Concurrency via Promise.all', () => {
  let service: PaymentsService;
  let prisma: any;
  let razorpay: any;
  let audit: any;

  const gymId = 'gym-1';
  const paymentId = 'pay-concurrent-1';

  beforeEach(async () => {
    prisma = {
      payment: {
        findFirst: jest.fn(),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: paymentId }),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      membershipMonth: {
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(1),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      membership: {
        update: jest.fn().mockResolvedValue({}),
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
      verifySignature: jest.fn().mockReturnValue(true),
      fetchPayment: jest.fn().mockResolvedValue({
        order_id: 'order_conc_1',
        amount: 100000,
        currency: 'INR',
        status: 'captured',
      }),
      refund: jest.fn().mockResolvedValue({ id: 'rfnd_1' }),
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

  describe('Concurrent Payment Verification Race', () => {
    it('handles concurrent verifyRazorpay requests via Promise.all without double processing', async () => {
      let isCompleted = false;
      prisma.payment.findFirst.mockImplementation(() => {
        return Promise.resolve({
          id: paymentId,
          gymId,
          gateway: 'RAZORPAY',
          gatewayOrderId: 'order_conc_1',
          status: isCompleted ? 'COMPLETED' : 'PENDING',
          total: 1000,
          membershipId: 'mem-1',
          member: { id: 'm-1' },
          gym: { name: 'Muscle Gym' },
        });
      });

      // When first updateMany executes in $transaction, mark completed
      prisma.payment.updateMany.mockImplementation(({ where }: any) => {
        if (where.status === 'PENDING') {
          if (!isCompleted) {
            isCompleted = true;
            return Promise.resolve({ count: 1 });
          }
          return Promise.resolve({ count: 0 });
        }
        return Promise.resolve({ count: 0 });
      });

      const dto = {
        paymentId,
        razorpayOrderId: 'order_conc_1',
        razorpayPaymentId: 'pay_rzp_999',
        razorpaySignature: 'sig_ok',
      };

      const [res1, res2] = await Promise.all([
        service.verifyRazorpay(dto, gymId),
        service.verifyRazorpay(dto, gymId),
      ]);

      expect(res1).toBeDefined();
      expect(res2).toBeDefined();
      // Atomic status transition in transaction was executed
      expect(prisma.payment.updateMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('Concurrent Refund Race Protection', () => {
    it('prevents double refund when two full refund requests are fired concurrently', async () => {
      let refundedAmount = 0;
      let status = 'COMPLETED';
      const totalAmount = 1000;

      prisma.payment.findFirst.mockImplementation(() => {
        return Promise.resolve({
          id: paymentId,
          gymId,
          status,
          total: totalAmount,
          refundedAmount,
          gateway: 'RAZORPAY',
          gatewayPaymentId: 'pay_rzp_orig',
          monthAllocations: [],
        });
      });

      prisma.payment.updateMany.mockImplementation(({ where, data }: any) => {
        if (where.status === status) {
          status = data.status;
          refundedAmount = data.refundedAmount;
          return Promise.resolve({ count: 1 });
        }
        return Promise.resolve({ count: 0 });
      });

      prisma.payment.findUniqueOrThrow.mockImplementation(() =>
        Promise.resolve({
          id: paymentId,
          gymId,
          status,
          total: totalAmount,
          refundedAmount,
        }),
      );

      const refundReq1 = service.refund(paymentId, gymId, { amount: 1000, reason: 'Request 1' }, 'user-1');
      const refundReq2 = service.refund(paymentId, gymId, { amount: 1000, reason: 'Request 2' }, 'user-1');

      const results = await Promise.allSettled([refundReq1, refundReq2]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      if (rejected[0].status === 'rejected') {
        const reason = rejected[0].reason;
        expect(reason instanceof ConflictException || reason instanceof BadRequestException).toBe(true);
      }
    });
  });
});
