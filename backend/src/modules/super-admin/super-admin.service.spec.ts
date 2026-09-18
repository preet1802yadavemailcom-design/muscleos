import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { GymStatus, PaymentStatus } from '@prisma/client';
import { AuditService } from '@shared/services/audit.service';

import { SuperAdminService } from './super-admin.service';


describe('SuperAdminService', () => {
  let service: SuperAdminService;
  let prisma: any;
  let audit: any;
  let redis: any;

  const gym = { id: 'gym-1', name: 'Iron Paradise', status: GymStatus.PENDING, deletedAt: null };
  const activeGym = { ...gym, status: GymStatus.ACTIVE };

  beforeEach(async () => {
    prisma = {
      gym: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      gymPlan: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      member: {
        count: jest.fn().mockResolvedValue(0),
      },
      payment: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { total: null } }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      attendance: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      refreshToken: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      userSession: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      // $transaction called by purgeGymSessions — resolve array-batch ops
      $transaction: jest.fn((ops: any) => (Array.isArray(ops) ? Promise.all(ops) : ops)),
    };
    audit = { log: jest.fn() };
    redis = {
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
    };

    const module = await Test.createTestingModule({
      providers: [
        SuperAdminService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    service = module.get(SuperAdminService);
  });

  // ─── approveGym ───────────────────────────────────────────────────────────

  describe('approveGym', () => {
    it('activates a pending gym and writes an audit log', async () => {
      prisma.gym.findFirst.mockResolvedValue(gym);
      prisma.gym.update.mockResolvedValue({ ...gym, status: GymStatus.ACTIVE });

      const result = await service.approveGym('gym-1', 'admin-1');

      expect(result.status).toBe(GymStatus.ACTIVE);
      expect(prisma.gym.update).toHaveBeenCalledWith({ where: { id: 'gym-1' }, data: { status: GymStatus.ACTIVE } });
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'GYM_APPROVED', entityId: 'gym-1' }));
    });

    it('rejects approving a gym that is already active', async () => {
      prisma.gym.findFirst.mockResolvedValue({ ...gym, status: GymStatus.ACTIVE });
      await expect(service.approveGym('gym-1', 'admin-1')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws NotFoundException for an unknown gym', async () => {
      prisma.gym.findFirst.mockResolvedValue(null);
      await expect(service.approveGym('missing', 'admin-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ─── suspendGym ───────────────────────────────────────────────────────────

  describe('suspendGym', () => {
    it('suspends an active gym with a reason', async () => {
      prisma.gym.findFirst.mockResolvedValue(activeGym);
      prisma.gym.update.mockResolvedValue({ ...activeGym, status: GymStatus.SUSPENDED });

      const result = await service.suspendGym('gym-1', { reason: 'Payment overdue' }, 'admin-1');

      expect(result.status).toBe(GymStatus.SUSPENDED);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'GYM_SUSPENDED', newValue: { reason: 'Payment overdue' } }),
      );
    });

    it('rejects suspending a gym that is already suspended', async () => {
      prisma.gym.findFirst.mockResolvedValue({ ...gym, status: GymStatus.SUSPENDED });
      await expect(
        service.suspendGym('gym-1', { reason: 'dup' }, 'admin-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('invokes session purge for gym users on suspension', async () => {
      const userId = 'user-abc';
      prisma.gym.findFirst.mockResolvedValue(activeGym);
      prisma.gym.update.mockResolvedValue({ ...activeGym, status: GymStatus.SUSPENDED });
      prisma.user.findMany.mockResolvedValue([{ id: userId }]);

      await service.suspendGym('gym-1', { reason: 'Purge test' }, 'admin-1');

      expect(prisma.$transaction).toHaveBeenCalledWith(
        expect.arrayContaining([expect.anything(), expect.anything()]),
      );
      expect(redis.set).toHaveBeenCalledWith(
        `user_revoked_at:${userId}`,
        expect.any(String),
        expect.any(Number),
      );
      expect(redis.del).toHaveBeenCalledWith(`session:${userId}`);
    });

    it('skips session purge when gym has no users', async () => {
      prisma.gym.findFirst.mockResolvedValue(activeGym);
      prisma.gym.update.mockResolvedValue({ ...activeGym, status: GymStatus.SUSPENDED });
      prisma.user.findMany.mockResolvedValue([]);

      await service.suspendGym('gym-1', { reason: 'Empty gym' }, 'admin-1');

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(redis.set).not.toHaveBeenCalled();
    });
  });

  // ─── deleteGym ────────────────────────────────────────────────────────────

  describe('deleteGym', () => {
    it('soft-deletes an existing gym and returns success message', async () => {
      prisma.gym.findFirst.mockResolvedValue(activeGym);
      prisma.gym.update.mockResolvedValue({ ...activeGym, deletedAt: new Date(), status: GymStatus.SUSPENDED });

      const result = await service.deleteGym('gym-1', 'admin-1');

      expect(result).toEqual({ message: 'Gym deleted successfully' });
    });

    it('uses soft delete (sets deletedAt) — never calls prisma.gym.delete', async () => {
      prisma.gym.findFirst.mockResolvedValue(activeGym);
      prisma.gym.update.mockResolvedValue({ ...activeGym, deletedAt: new Date(), status: GymStatus.SUSPENDED });

      await service.deleteGym('gym-1', 'admin-1');

      // Hard delete must never be called
      expect(prisma.gym.delete).toBeUndefined();
      const updateArg = prisma.gym.update.mock.calls[0][0];
      expect(updateArg.data.deletedAt).toBeInstanceOf(Date);
      expect(updateArg.data.status).toBe(GymStatus.SUSPENDED);
    });

    it('scopes update to the specific gym id — does not delete unrelated gyms', async () => {
      prisma.gym.findFirst.mockResolvedValue(activeGym);
      prisma.gym.update.mockResolvedValue({ ...activeGym, deletedAt: new Date(), status: GymStatus.SUSPENDED });

      await service.deleteGym('gym-1', 'admin-1');

      expect(prisma.gym.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'gym-1' } }),
      );
    });

    it('writes a GYM_DELETED audit log', async () => {
      prisma.gym.findFirst.mockResolvedValue(activeGym);
      prisma.gym.update.mockResolvedValue({ ...activeGym, deletedAt: new Date(), status: GymStatus.SUSPENDED });

      await service.deleteGym('gym-1', 'admin-1');

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'GYM_DELETED', entityId: 'gym-1' }),
      );
    });

    it('throws NotFoundException for a non-existent gym — no update performed', async () => {
      prisma.gym.findFirst.mockResolvedValue(null);

      await expect(service.deleteGym('no-such-gym', 'admin-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.gym.update).not.toHaveBeenCalled();
    });

    it('purges sessions for all users of the deleted gym', async () => {
      const userIds = ['u-1', 'u-2'];
      prisma.gym.findFirst.mockResolvedValue(activeGym);
      prisma.gym.update.mockResolvedValue({ ...activeGym, deletedAt: new Date(), status: GymStatus.SUSPENDED });
      prisma.user.findMany.mockResolvedValue(userIds.map((id) => ({ id })));

      await service.deleteGym('gym-1', 'admin-1');

      expect(prisma.$transaction).toHaveBeenCalled();
      for (const uid of userIds) {
        expect(redis.set).toHaveBeenCalledWith(`user_revoked_at:${uid}`, expect.any(String), expect.any(Number));
        expect(redis.del).toHaveBeenCalledWith(`session:${uid}`);
      }
    });
  });

  // ─── purgeGymSessions resilience ──────────────────────────────────────────

  describe('purgeGymSessions resilience', () => {
    it('atomically revokes DB tokens and sessions via $transaction', async () => {
      const userIds = ['u-1', 'u-2'];
      prisma.gym.findFirst.mockResolvedValue(activeGym);
      prisma.gym.update.mockResolvedValue({ ...activeGym, status: GymStatus.SUSPENDED });
      prisma.user.findMany.mockResolvedValue(userIds.map((id) => ({ id })));

      await service.suspendGym('gym-1', { reason: 'txn test' }, 'admin-1');

      expect(prisma.$transaction).toHaveBeenCalled();
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: { in: userIds } }) }),
      );
      expect(prisma.userSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: { in: userIds } }) }),
      );
    });

    it('logs error and does NOT throw when Redis purge fails (DB revocation already committed)', async () => {
      prisma.gym.findFirst.mockResolvedValue(activeGym);
      prisma.gym.update.mockResolvedValue({ ...activeGym, status: GymStatus.SUSPENDED });
      prisma.user.findMany.mockResolvedValue([{ id: 'u-redis-fail' }]);
      redis.set.mockRejectedValue(new Error('Redis connection refused'));

      // Service must NOT re-throw the Redis error
      await expect(
        service.suspendGym('gym-1', { reason: 'redis down' }, 'admin-1'),
      ).resolves.toBeDefined();

      // DB transaction was still committed
      expect(prisma.$transaction).toHaveBeenCalled();
      // Audit log still written
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'GYM_SUSPENDED' }));
    });
  });

  // ─── analytics ────────────────────────────────────────────────────────────

  describe('analytics', () => {
    beforeEach(() => {
      prisma.payment.findMany.mockResolvedValue([]);
      prisma.attendance.findMany.mockResolvedValue([]);
    });

    it('returns empty series when no data exists', async () => {
      const result = await service.analytics(30);
      expect(result.revenueByDay).toEqual([]);
      expect(result.attendanceByDay).toEqual([]);
      expect(result.periodDays).toBe(30);
    });

    it('accepts days=1 (minimum valid)', async () => {
      const result = await service.analytics(1);
      expect(result.periodDays).toBe(1);
    });

    it('accepts days=365 (maximum valid)', async () => {
      const result = await service.analytics(365);
      expect(result.periodDays).toBe(365);
    });

    it('clamps days=366 to 365 (server-side guard)', async () => {
      const result = await service.analytics(366);
      expect(result.periodDays).toBe(365);
    });

    it('clamps days=3650 to 365 (server-side guard)', async () => {
      const result = await service.analytics(3650);
      expect(result.periodDays).toBe(365);
    });

    it('clamps days=0 to 1 (server-side guard)', async () => {
      const result = await service.analytics(0);
      expect(result.periodDays).toBe(1);
    });

    it('clamps negative days to 1', async () => {
      const result = await service.analytics(-10);
      expect(result.periodDays).toBe(1);
    });

    it('falls back to 30 when days is NaN', async () => {
      const result = await service.analytics(NaN);
      expect(result.periodDays).toBe(30);
    });

    it('applies a take/row limit to both Prisma queries', async () => {
      await service.analytics(30);
      const paymentArg = prisma.payment.findMany.mock.calls[0][0];
      const attendanceArg = prisma.attendance.findMany.mock.calls[0][0];
      expect(paymentArg.take).toBeDefined();
      expect(attendanceArg.take).toBeDefined();
      expect(paymentArg.take).toBeLessThanOrEqual(100_000);
      expect(attendanceArg.take).toBeLessThanOrEqual(100_000);
    });

    it('groups payment and attendance rows by date correctly', async () => {
      const day = '2026-08-01';
      prisma.payment.findMany.mockResolvedValue([
        { createdAt: new Date(`${day}T10:00:00Z`), total: 500 },
        { createdAt: new Date(`${day}T14:00:00Z`), total: 200 },
      ]);
      prisma.attendance.findMany.mockResolvedValue([
        { checkInAt: new Date(`${day}T09:00:00Z`) },
        { checkInAt: new Date(`${day}T11:00:00Z`) },
        { checkInAt: new Date(`${day}T11:30:00Z`) },
      ]);

      const result = await service.analytics(30);

      const revEntry = result.revenueByDay.find((e: any) => e.date === day);
      expect(revEntry).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      expect(revEntry!.value).toBeCloseTo(700, 1);

      const attEntry = result.attendanceByDay.find((e: any) => e.date === day);
      expect(attEntry).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      expect(attEntry!.value).toBe(3);
    });
  });

  // ─── dashboardStats ───────────────────────────────────────────────────────

  describe('dashboardStats', () => {
    it('returns the expected shape with zero values for an empty platform', async () => {
      prisma.gym.count.mockResolvedValue(0);
      prisma.member.count.mockResolvedValue(0);
      prisma.user.count.mockResolvedValue(0);
      prisma.payment.aggregate.mockResolvedValue({ _sum: { total: null } });

      const result = await service.dashboardStats();

      expect(result).toMatchObject({
        gyms: expect.objectContaining({ total: expect.any(Number), active: expect.any(Number) }),
        members: expect.objectContaining({ total: expect.any(Number) }),
        trainers: expect.objectContaining({ total: expect.any(Number) }),
        revenue: expect.objectContaining({ total: expect.any(Number) }),
      });
      // null aggregate must be coerced to 0, not leak null to the caller
      expect(result.revenue.total).toBe(0);
      expect(result.revenue.last30Days).toBe(0);
    });

    it('does not apply a gymId filter (cross-platform stats)', async () => {
      prisma.gym.count.mockResolvedValue(0);
      prisma.member.count.mockResolvedValue(0);
      prisma.user.count.mockResolvedValue(0);
      prisma.payment.aggregate.mockResolvedValue({ _sum: { total: null } });

      await service.dashboardStats();

      prisma.gym.count.mock.calls.forEach((call: any[]) => {
        expect(call[0]?.where?.gymId).toBeUndefined();
      });
    });
  });

  // ─── listGyms ─────────────────────────────────────────────────────────────

  describe('listGyms', () => {
    const gymRow = {
      id: 'gym-1', name: 'Iron Paradise', email: 'owner@iron.com',
      status: GymStatus.ACTIVE, planType: 'YEARLY', deletedAt: null,
      _count: { members: 40, users: 5, batches: 6 },
    };

    it('returns paginated gym list with meta', async () => {
      prisma.gym.findMany.mockResolvedValue([gymRow]);
      prisma.gym.count.mockResolvedValue(1);

      const result = await service.listGyms({ page: 1, limit: 20 } as any);

      expect(result.data).toHaveLength(1);
      expect(result.meta).toMatchObject({ total: 1, page: 1, limit: 20 });
    });

    it('returns empty list when no gyms exist', async () => {
      prisma.gym.findMany.mockResolvedValue([]);
      prisma.gym.count.mockResolvedValue(0);

      const result = await service.listGyms({ page: 1, limit: 20 } as any);

      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
    });

    it('applies status filter when provided', async () => {
      prisma.gym.findMany.mockResolvedValue([]);
      prisma.gym.count.mockResolvedValue(0);

      await service.listGyms({ page: 1, limit: 20, status: GymStatus.PENDING } as any);

      const whereArg = prisma.gym.findMany.mock.calls[0][0].where;
      expect(whereArg.status).toBe(GymStatus.PENDING);
    });

    it('filters out soft-deleted gyms (deletedAt: null)', async () => {
      prisma.gym.findMany.mockResolvedValue([gymRow]);
      prisma.gym.count.mockResolvedValue(1);

      await service.listGyms({ page: 1, limit: 20 } as any);

      const whereArg = prisma.gym.findMany.mock.calls[0][0].where;
      expect(whereArg.deletedAt).toBeNull();
    });

    it('does not include password or secret fields in the query', async () => {
      prisma.gym.findMany.mockResolvedValue([gymRow]);
      prisma.gym.count.mockResolvedValue(1);

      await service.listGyms({ page: 1, limit: 20 } as any);

      const includeArg = prisma.gym.findMany.mock.calls[0][0].include;
      expect(JSON.stringify(includeArg)).not.toContain('password');
      expect(JSON.stringify(includeArg)).not.toContain('secret');
    });
  });

  // ─── createPlan ───────────────────────────────────────────────────────────

  describe('createPlan', () => {
    it('rejects a duplicate plan name', async () => {
      prisma.gymPlan.findUnique.mockResolvedValue({ id: 'existing-plan' });
      await expect(
        service.createPlan({ name: 'Yearly', type: 'YEARLY', monthlyPrice: 10, yearlyPrice: 100 } as any, 'admin-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.gymPlan.create).not.toHaveBeenCalled();
    });

    it('creates a plan when the name is unique', async () => {
      prisma.gymPlan.findUnique.mockResolvedValue(null);
      prisma.gymPlan.create.mockResolvedValue({ id: 'plan-1', name: 'Yearly' });

      const result = await service.createPlan(
        { name: 'Yearly', type: 'YEARLY', monthlyPrice: 10, yearlyPrice: 100 } as any,
        'admin-1',
      );

      expect(result.id).toBe('plan-1');
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'PLAN_CREATED' }));
    });
  });

  // ─── exportData ───────────────────────────────────────────────────────────

  describe('exportData', () => {
    it('flattens gyms into export rows', async () => {
      prisma.gym.findMany.mockResolvedValue([
        {
          id: 'gym-1',
          name: 'Iron Paradise',
          email: 'owner@iron.com',
          status: GymStatus.ACTIVE,
          planType: 'YEARLY',
          createdAt: new Date('2026-01-01'),
          _count: { members: 40, users: 5, batches: 6 },
        },
      ]);

      const rows = await service.exportData({} as any);

      expect(rows).toEqual([
        expect.objectContaining({ id: 'gym-1', members: 40, staff: 5, batches: 6 }),
      ]);
    });
  });
});

