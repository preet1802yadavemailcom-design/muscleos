import { Test } from '@nestjs/testing';
import { PrismaService } from '@database/prisma.service';
import { AuditService } from '@shared/services/audit.service';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { MembershipsService } from './memberships.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('MembershipsService — transfer by UUID and memberCode', () => {
  let service: MembershipsService;
  let prisma: any;

  const gymId = 'gym-1';
  const sourceMembershipId = 'membership-src';
  const sourceMemberId = 'member-src';
  const targetMemberId = 'member-tgt';
  const targetMemberCode = 'MEM-999';

  beforeEach(async () => {
    prisma = {
      member: {
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      membership: {
        findFirst: jest.fn(),
        create: jest.fn().mockResolvedValue({
          id: 'membership-new',
          startDate: new Date(),
          duration: 30,
          totalAmount: 1180,
        }),
        update: jest.fn().mockResolvedValue({ id: sourceMembershipId }),
      },
      membershipMonth: {
        create: jest.fn().mockResolvedValue({}),
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

  it('transfers membership successfully using target memberCode', async () => {
    prisma.membership.findFirst.mockResolvedValue({
      id: sourceMembershipId,
      gymId,
      memberId: sourceMemberId,
      status: 'ACTIVE',
      endDate: new Date(Date.now() + 30 * 86400000),
      plan: 'MONTHLY',
      planName: 'Monthly Gold',
      baseAmount: 1000,
      discountAmount: 0,
      taxAmount: 180,
      totalAmount: 1180,
      member: { id: sourceMemberId, currentMembershipId: sourceMembershipId },
    });

    prisma.member.findFirst.mockResolvedValue({
      id: targetMemberId,
      memberCode: targetMemberCode,
      gymId,
    });

    const res = await service.transfer(sourceMembershipId, gymId, { toMemberId: targetMemberCode });

    expect(prisma.member.findFirst).toHaveBeenCalledWith({
      where: {
        gymId,
        deletedAt: null,
        OR: [{ id: targetMemberCode }, { memberCode: targetMemberCode }],
      },
    });
    expect(res.id).toBe('membership-new');
  });

  it('transfers membership successfully using target UUID', async () => {
    prisma.membership.findFirst.mockResolvedValue({
      id: sourceMembershipId,
      gymId,
      memberId: sourceMemberId,
      status: 'ACTIVE',
      endDate: new Date(Date.now() + 30 * 86400000),
      plan: 'MONTHLY',
      planName: 'Monthly Gold',
      baseAmount: 1000,
      discountAmount: 0,
      taxAmount: 180,
      totalAmount: 1180,
      member: { id: sourceMemberId, currentMembershipId: sourceMembershipId },
    });

    prisma.member.findFirst.mockResolvedValue({
      id: targetMemberId,
      memberCode: targetMemberCode,
      gymId,
    });

    const res = await service.transfer(sourceMembershipId, gymId, { toMemberId: targetMemberId });

    expect(prisma.member.findFirst).toHaveBeenCalledWith({
      where: {
        gymId,
        deletedAt: null,
        OR: [{ id: targetMemberId }, { memberCode: targetMemberId }],
      },
    });
    expect(res.id).toBe('membership-new');
  });

  it('prevents self-transfer when memberCode resolves to source member', async () => {
    prisma.membership.findFirst.mockResolvedValue({
      id: sourceMembershipId,
      gymId,
      memberId: sourceMemberId,
      status: 'ACTIVE',
      endDate: new Date(Date.now() + 30 * 86400000),
    });

    prisma.member.findFirst.mockResolvedValue({
      id: sourceMemberId,
      memberCode: 'MEM-SRC',
      gymId,
    });

    await expect(
      service.transfer(sourceMembershipId, gymId, { toMemberId: 'MEM-SRC' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
