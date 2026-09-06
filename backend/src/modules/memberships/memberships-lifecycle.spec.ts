import { Test } from '@nestjs/testing';
import { PrismaService } from '@database/prisma.service';
import { AuditService } from '@shared/services/audit.service';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { MembershipsService } from './memberships.service';

describe('MembershipsService — lifecycle and ghost ledger integrity', () => {
  let service: MembershipsService;
  let prisma: any;

  const gymId = 'gym-1';
  const memberId = 'member-1';
  const membershipId = 'membership-1';

  beforeEach(async () => {
    prisma = {
      member: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      membership: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      membershipMonth: {
        create: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };

    const module = await Test.createTestingModule({
      providers: [
        MembershipsService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: { send: jest.fn().mockResolvedValue(true) } },
        { provide: AuditService, useValue: { log: jest.fn().mockResolvedValue(true) } },
      ],
    }).compile();

    service = module.get(MembershipsService);
  });

  describe('remove', () => {
    it('cancels membership, purges unbilled months, and updates member currentMembershipId', async () => {
      prisma.membership.findFirst
        .mockResolvedValueOnce({
          id: membershipId,
          gymId,
          memberId,
          status: 'ACTIVE',
        })
        .mockResolvedValueOnce(null);
      prisma.member.findUnique.mockResolvedValue({
        id: memberId,
        currentMembershipId: membershipId,
      });

      const res = await service.remove(membershipId, gymId);
      expect(res.message).toBe('Membership cancelled successfully');

      // 1. Membership marked CANCELLED
      expect(prisma.membership.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: membershipId },
          data: expect.objectContaining({ status: 'CANCELLED' }),
        }),
      );

      // 2. Unbilled months deleted
      expect(prisma.membershipMonth.deleteMany).toHaveBeenCalledWith({
        where: {
          membershipId,
          status: { in: ['LOCKED', 'PAYABLE', 'PENDING'] },
        },
      });

      // 3. Member updated: currentMembershipId cleared
      expect(prisma.member.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: memberId },
          data: expect.objectContaining({ currentMembershipId: null, status: 'INACTIVE' }),
        }),
      );
    });
  });

  describe('create', () => {
    it('cancels any prior active memberships and purges unbilled months before creating new one', async () => {
      prisma.member.findFirst.mockResolvedValue({
        id: memberId,
        gymId,
        firstName: 'John',
      });
      prisma.membership.findMany.mockResolvedValue([
        { id: 'old-active-m', status: 'ACTIVE', memberId },
      ]);
      prisma.membership.create.mockResolvedValue({
        id: 'new-m-1',
        memberId,
        gymId,
        plan: 'MONTHLY',
        planName: 'MONTHLY',
        duration: 30,
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 86400000),
        totalAmount: 1500,
        status: 'ACTIVE',
      });

      await service.create(gymId, {
        memberId,
        plan: 'MONTHLY' as any,
        baseAmount: 1500,
      });

      // Old active membership cancelled
      expect(prisma.membership.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'old-active-m' },
          data: expect.objectContaining({ status: 'CANCELLED' }),
        }),
      );
      // Old unbilled months purged
      expect(prisma.membershipMonth.deleteMany).toHaveBeenCalledWith({
        where: {
          membershipId: 'old-active-m',
          status: { in: ['LOCKED', 'PAYABLE', 'PENDING'] },
        },
      });
      // New membership created and linked
      expect(prisma.member.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: memberId },
          data: expect.objectContaining({ currentMembershipId: 'new-m-1', status: 'ACTIVE' }),
        }),
      );
    });
  });
});
