import { PrismaService } from '@database/prisma.service';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuditService } from '@shared/services/audit.service';

import { MembershipsService } from './memberships.service';

/**
 * Regression coverage for the IDOR found+fixed this session: GET
 * /memberships and /memberships/:id previously had no @Roles guard, so any
 * authenticated MEMBER could list/view every member's membership data in
 * the gym. The fix was restricting those to staff and adding this
 * findMine() method, resolved via the canonical Member.userId identity
 * chain — these tests exist specifically to catch a regression where
 * findMine silently starts trusting a client-supplied id again.
 */
describe('MembershipsService#findMine (IDOR regression coverage)', () => {
  let service: MembershipsService;
  let prisma: any;

  const gymId = 'gym-1';
  const userId = 'user-me';
  const myMemberId = 'member-me';

  beforeEach(async () => {
    prisma = {
      member: { findFirst: jest.fn() },
      membership: { findMany: jest.fn() },
    };

    const module = await Test.createTestingModule({
      providers: [
        MembershipsService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: {} },
        { provide: AuditService, useValue: { log: jest.fn() } },
      ],
    }).compile();

    service = module.get(MembershipsService);
  });

  it('resolves the member via userId, never via a client-supplied memberId', async () => {
    prisma.member.findFirst.mockResolvedValue({ id: myMemberId });
    prisma.membership.findMany.mockResolvedValue([]);

    await service.findMine(gymId, userId);

    expect(prisma.member.findFirst).toHaveBeenCalledWith({
      where: { userId, gymId, deletedAt: null },
    });
  });

  it('only queries memberships scoped to the resolved member — never all memberships in the gym', async () => {
    prisma.member.findFirst.mockResolvedValue({ id: myMemberId });
    prisma.membership.findMany.mockResolvedValue([]);

    await service.findMine(gymId, userId);

    const callArgs = prisma.membership.findMany.mock.calls[0][0];
    expect(callArgs.where.memberId).toBe(myMemberId);
    expect(callArgs.where.memberId).not.toBeUndefined();
  });

  it('throws NotFoundException rather than falling back to any other match when no Member is linked', async () => {
    prisma.member.findFirst.mockResolvedValue(null);

    await expect(service.findMine(gymId, userId)).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.membership.findMany).not.toHaveBeenCalled();
  });
});
