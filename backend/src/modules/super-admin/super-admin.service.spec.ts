import { PrismaService } from '@database/prisma.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { GymStatus } from '@prisma/client';
import { AuditService } from '@shared/services/audit.service';

import { SuperAdminService } from './super-admin.service';


describe('SuperAdminService', () => {
  let service: SuperAdminService;
  let prisma: any;
  let audit: any;

  const gym = { id: 'gym-1', name: 'Iron Paradise', status: GymStatus.PENDING, deletedAt: null };

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
    };
    audit = { log: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        SuperAdminService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get(SuperAdminService);
  });

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

  describe('suspendGym', () => {
    it('suspends an active gym with a reason', async () => {
      prisma.gym.findFirst.mockResolvedValue({ ...gym, status: GymStatus.ACTIVE });
      prisma.gym.update.mockResolvedValue({ ...gym, status: GymStatus.SUSPENDED });

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
  });

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
