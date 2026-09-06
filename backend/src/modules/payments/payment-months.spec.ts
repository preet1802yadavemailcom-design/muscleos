import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
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

/**
 * Coverage for the month-allocation payment ledger added this session:
 * priceMonths() (shared server-side pricing/validation used by both staff
 * manual payments and member UPI claims) and recordManualPaymentWithMonths()
 * (staff-facing cash/UPI-wall recording). These are the highest-risk untested
 * paths in the codebase since a bug here means either a member is charged
 * the wrong amount, or a month gets marked PAID without a real payment
 * behind it. Every test here targets a rule the spec explicitly calls out:
 * amount is never client-supplied, earlier unpaid months block later ones,
 * gaps in the selected months are rejected, and cash vs non-cash produce
 * different payment statuses.
 */
describe('PaymentsService — month allocation (payment ledger regression coverage)', () => {
  let service: PaymentsService;
  let prisma: any;

  const gymId = 'gym-1';
  const membershipId = 'membership-1';

  const month = (id: string, monthStart: string, amountDue: number, status: string) => ({
    id,
    monthStart: new Date(monthStart),
    amountDue,
    status,
  });

  beforeEach(async () => {
    prisma = {
      membership: { findFirst: jest.fn() },
      membershipMonth: {
        findMany: jest.fn(),
        count: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      member: { findFirst: jest.fn() },
      payment: { create: jest.fn().mockResolvedValue({ id: 'payment-1' }), findFirst: jest.fn(), update: jest.fn() },
      paymentMonthAllocation: { create: jest.fn() },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };

    const module = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: LoggerService, useValue: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } },
        { provide: RazorpayGateway, useValue: {} },
        { provide: StripeGateway, useValue: {} },
        { provide: InvoiceGenerator, useValue: {} },
        { provide: NotificationsService, useValue: {} },
        { provide: SequenceService, useValue: { next: jest.fn().mockResolvedValue(1) } },
      ],
    }).compile();

    service = module.get(PaymentsService);
  });

  describe('recordManualPaymentWithMonths', () => {
    it('computes the total from server-side amountDue, never from client input', async () => {
      prisma.membership.findFirst.mockResolvedValue({ id: membershipId, gymId, memberId: 'member-1' });
      prisma.membershipMonth.findMany.mockResolvedValue([
        month('m1', '2026-05-01', 1500, 'PAYABLE'),
      ]);
      prisma.membershipMonth.count.mockResolvedValue(0);

      const result = await service.recordManualPaymentWithMonths(gymId, 'staff-1', {
        membershipId,
        monthStarts: ['2026-05-01'],
        gateway: 'CASH' as any,
        method: 'CASH' as any,
      });

      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ amount: 1500, total: 1500 }) }),
      );
      expect(result).toBeDefined();
    });

    it('rejects a month that does not exist for this membership', async () => {
      prisma.membership.findFirst.mockResolvedValue({ id: membershipId, gymId, memberId: 'member-1' });
      prisma.membershipMonth.findMany.mockResolvedValue([]); // none found

      await expect(
        service.recordManualPaymentWithMonths(gymId, 'staff-1', {
          membershipId,
          monthStarts: ['2026-05-01'],
          gateway: 'CASH' as any,
          method: 'CASH' as any,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a month that is already PAID', async () => {
      prisma.membership.findFirst.mockResolvedValue({ id: membershipId, gymId, memberId: 'member-1' });
      prisma.membershipMonth.findMany.mockResolvedValue([month('m1', '2026-05-01', 1500, 'PAID')]);

      await expect(
        service.recordManualPaymentWithMonths(gymId, 'staff-1', {
          membershipId,
          monthStarts: ['2026-05-01'],
          gateway: 'CASH' as any,
          method: 'CASH' as any,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a month that already has a PENDING verification', async () => {
      prisma.membership.findFirst.mockResolvedValue({ id: membershipId, gymId, memberId: 'member-1' });
      prisma.membershipMonth.findMany.mockResolvedValue([month('m1', '2026-05-01', 1500, 'PENDING')]);

      await expect(
        service.recordManualPaymentWithMonths(gymId, 'staff-1', {
          membershipId,
          monthStarts: ['2026-05-01'],
          gateway: 'CASH' as any,
          method: 'CASH' as any,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects paying a later month while an earlier month is still unpaid (no skipping)', async () => {
      prisma.membership.findFirst.mockResolvedValue({ id: membershipId, gymId, memberId: 'member-1' });
      prisma.membershipMonth.findMany.mockResolvedValue([month('m2', '2026-06-01', 1500, 'LOCKED')]);
      prisma.membershipMonth.count.mockResolvedValue(1); // an earlier unpaid month exists

      await expect(
        service.recordManualPaymentWithMonths(gymId, 'staff-1', {
          membershipId,
          monthStarts: ['2026-06-01'],
          gateway: 'CASH' as any,
          method: 'CASH' as any,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a non-consecutive month selection (gap between selected months)', async () => {
      prisma.membership.findFirst.mockResolvedValue({ id: membershipId, gymId, memberId: 'member-1' });
      prisma.membershipMonth.findMany.mockResolvedValue([
        month('m1', '2026-05-01', 1500, 'PAYABLE'),
        month('m3', '2026-07-01', 1500, 'LOCKED'), // skips June
      ]);
      prisma.membershipMonth.count.mockResolvedValue(0);

      await expect(
        service.recordManualPaymentWithMonths(gymId, 'staff-1', {
          membershipId,
          monthStarts: ['2026-05-01', '2026-07-01'],
          gateway: 'CASH' as any,
          method: 'CASH' as any,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('marks cash payments COMPLETED immediately and months PAID', async () => {
      prisma.membership.findFirst.mockResolvedValue({ id: membershipId, gymId, memberId: 'member-1' });
      prisma.membershipMonth.findMany.mockResolvedValue([month('m1', '2026-05-01', 1500, 'PAYABLE')]);
      prisma.membershipMonth.count.mockResolvedValue(0);
      prisma.payment.create.mockResolvedValue({ id: 'payment-1' });

      await service.recordManualPaymentWithMonths(gymId, 'staff-1', {
        membershipId,
        monthStarts: ['2026-05-01'],
        gateway: 'CASH' as any,
        method: 'CASH' as any,
      });

      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) }),
      );
      expect(prisma.membershipMonth.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'PAID' }) }),
      );
    });

    it('marks non-cash (UPI/bank) payments PENDING, not immediately PAID', async () => {
      prisma.membership.findFirst.mockResolvedValue({ id: membershipId, gymId, memberId: 'member-1' });
      prisma.membershipMonth.findMany.mockResolvedValue([month('m1', '2026-05-01', 1500, 'PAYABLE')]);
      prisma.membershipMonth.count.mockResolvedValue(0);
      prisma.payment.create.mockResolvedValue({ id: 'payment-1' });

      await service.recordManualPaymentWithMonths(gymId, 'staff-1', {
        membershipId,
        monthStarts: ['2026-05-01'],
        gateway: 'UPI' as any,
        method: 'UPI' as any,
      });

      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING' }) }),
      );
      expect(prisma.membershipMonth.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING' }) }),
      );
    });

    it('splits the total correctly across multiple selected months', async () => {
      prisma.membership.findFirst.mockResolvedValue({ id: membershipId, gymId, memberId: 'member-1' });
      prisma.membershipMonth.findMany.mockResolvedValue([
        month('m1', '2026-05-01', 1200, 'PAYABLE'),
        month('m2', '2026-06-01', 1200, 'LOCKED'),
      ]);
      prisma.membershipMonth.count.mockResolvedValue(0);

      await service.recordManualPaymentWithMonths(gymId, 'staff-1', {
        membershipId,
        monthStarts: ['2026-05-01', '2026-06-01'],
        gateway: 'CASH' as any,
        method: 'CASH' as any,
      });

      expect(prisma.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ amount: 2400, total: 2400 }) }),
      );
      expect(prisma.paymentMonthAllocation.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('consecutive-month check is timezone-safe (UTC regression)', () => {
    // Regression test for a real bug found via this suite: the consecutive-month
    // check used to build "next month" with new Date(year, month+1, 1) (LOCAL time)
    // while DB-sourced monthStart values are UTC midnight. On any machine whose
    // timezone is not UTC (e.g. IST, UTC+5:30) this made legitimately consecutive
    // months look "non-consecutive" and incorrectly rejected a valid payment. Now
    // fixed to use Date.UTC(...) consistently. This test intentionally does NOT
    // mock the system timezone -- it must pass regardless of the host's local TZ.
    it('accepts two genuinely consecutive months regardless of host timezone', async () => {
      prisma.membership.findFirst.mockResolvedValue({ id: membershipId, gymId, memberId: 'member-1' });
      prisma.membershipMonth.findMany.mockResolvedValue([
        month('m1', '2026-05-01', 1200, 'PAYABLE'),
        month('m2', '2026-06-01', 1200, 'LOCKED'),
      ]);
      prisma.membershipMonth.count.mockResolvedValue(0);

      await expect(
        service.recordManualPaymentWithMonths(gymId, 'staff-1', {
          membershipId,
          monthStarts: ['2026-05-01', '2026-06-01'],
          gateway: 'CASH' as any,
          method: 'CASH' as any,
        }),
      ).resolves.toBeDefined();
    });

    it('still rejects a real gap (May then July, skipping June)', async () => {
      prisma.membership.findFirst.mockResolvedValue({ id: membershipId, gymId, memberId: 'member-1' });
      prisma.membershipMonth.findMany.mockResolvedValue([
        month('m1', '2026-05-01', 1200, 'PAYABLE'),
        month('m3', '2026-07-01', 1200, 'LOCKED'),
      ]);
      prisma.membershipMonth.count.mockResolvedValue(0);

      await expect(
        service.recordManualPaymentWithMonths(gymId, 'staff-1', {
          membershipId,
          monthStarts: ['2026-05-01', '2026-07-01'],
          gateway: 'CASH' as any,
          method: 'CASH' as any,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('member self-serve UPI claim ownership (assertOwnMembership)', () => {
    it('blocks a member from claiming a payment against a membership that is not theirs', async () => {
      prisma.member.findFirst.mockResolvedValue({ id: 'member-1', userId: 'user-1' });
      prisma.membership.findFirst.mockResolvedValue(null); // membership doesn't belong to this member

      await expect(
        service.submitUpiClaim(gymId, 'user-1', 'someone-elses-membership', ['2026-05-01'], 'UTR123456'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('blocks a UPI claim with no linked member profile', async () => {
      prisma.member.findFirst.mockResolvedValue(null);

      await expect(
        service.submitUpiClaim(gymId, 'user-ghost', membershipId, ['2026-05-01'], 'UTR123456'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a UPI claim with a too-short UTR', async () => {
      prisma.member.findFirst.mockResolvedValue({ id: 'member-1', userId: 'user-1' });
      prisma.membership.findFirst.mockResolvedValue({ id: membershipId, gymId, memberId: 'member-1' });

      await expect(
        service.submitUpiClaim(gymId, 'user-1', membershipId, ['2026-05-01'], '12'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
