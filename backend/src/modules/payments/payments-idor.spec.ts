import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@database/prisma.service';
import { AuditService } from '@shared/services/audit.service';
import { LoggerService } from '@shared/services/logger.service';

import { PaymentsService } from './payments.service';
import { RazorpayGateway } from './gateways/razorpay.gateway';
import { StripeGateway } from './gateways/stripe.gateway';
import { InvoiceGenerator } from './invoice.generator';

/**
 * Regression coverage for the IDOR found+fixed this session: GET
 * /payments/:id and /:id/receipt had no @Roles guard, so any authenticated
 * MEMBER could view/download any other member's payment or receipt just by
 * guessing/incrementing an id. Fixed with @Roles restricting the plain
 * findOne route to staff, plus assertCanView as a second, independent
 * ownership check — these tests target assertCanView directly so a future
 * refactor that accidentally removes the ownership check (even if @Roles
 * stays correct) still fails CI.
 */
describe('PaymentsService — payment ownership (IDOR regression coverage)', () => {
  let service: PaymentsService;
  let prisma: any;

  const gymId = 'gym-1';
  const targetPaymentId = 'payment-123';
  const targetMemberId = 'member-owner';

  beforeEach(async () => {
    prisma = {
      payment: { findFirst: jest.fn() },
      member: { findFirst: jest.fn() },
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
      ],
    }).compile();

    service = module.get(PaymentsService);
  });

  it('allows a member to view a payment that belongs to them', async () => {
    prisma.payment.findFirst.mockResolvedValue({ id: targetPaymentId, memberId: targetMemberId });
    prisma.member.findFirst.mockResolvedValue({ id: targetMemberId, userId: 'user-owner' });

    await expect(
      service.findOne(targetPaymentId, gymId, { userId: 'user-owner', role: 'MEMBER' }),
    ).resolves.toBeDefined();
  });

  it('blocks a member from viewing a DIFFERENT member\'s payment by id', async () => {
    prisma.payment.findFirst.mockResolvedValue({ id: targetPaymentId, memberId: targetMemberId });
    // The requester's own Member row resolves to someone else entirely.
    prisma.member.findFirst.mockResolvedValue({ id: 'member-attacker', userId: 'user-attacker' });

    await expect(
      service.findOne(targetPaymentId, gymId, { userId: 'user-attacker', role: 'MEMBER' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks a member with no linked Member profile at all', async () => {
    prisma.payment.findFirst.mockResolvedValue({ id: targetPaymentId, memberId: targetMemberId });
    prisma.member.findFirst.mockResolvedValue(null);

    await expect(
      service.findOne(targetPaymentId, gymId, { userId: 'user-nobody', role: 'MEMBER' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not apply the ownership check to staff roles (already gated by @Roles at the controller)', async () => {
    prisma.payment.findFirst.mockResolvedValue({ id: targetPaymentId, memberId: targetMemberId });

    await expect(
      service.findOne(targetPaymentId, gymId, { userId: 'owner-user', role: 'GYM_OWNER' }),
    ).resolves.toBeDefined();
    // Ownership lookup is a MEMBER-only concern — staff shouldn't even
    // trigger the extra Member lookup.
    expect(prisma.member.findFirst).not.toHaveBeenCalled();
  });

  it('throws NotFoundException for a payment id that does not exist, before any ownership check', async () => {
    prisma.payment.findFirst.mockResolvedValue(null);

    await expect(
      service.findOne('nonexistent', gymId, { userId: 'user-owner', role: 'MEMBER' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
