import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@database/prisma.service';
import { AuditService } from '@shared/services/audit.service';
import { FitnessService } from './fitness.service';

describe('FitnessService', () => {
  let service: FitnessService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      member: {
        findFirst: jest.fn().mockResolvedValue({ id: 'member-1', gymId: 'gym-1' }),
      },
      dietPlan: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({ id: 'diet-1', title: 'Cut Plan' }),
      },
      workoutPlan: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue({ id: 'workout-1', title: 'PPL' }),
      },
      memberProgress: {
        create: jest.fn().mockResolvedValue({ id: 'prog-1', memberId: 'member-1', weight: 75.5 }),
        findMany: jest.fn().mockResolvedValue([{ id: 'prog-1', memberId: 'member-1', weight: 75.5 }]),
      },
      $transaction: jest.fn().mockImplementation(async (callback) => {
        return callback(prisma);
      }),
    };

    const module = await Test.createTestingModule({
      providers: [
        FitnessService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { log: jest.fn() } },
      ],
    }).compile();

    service = module.get(FitnessService);
  });

  describe('createDietPlan', () => {
    it('throws BadRequestException when meals array is empty', async () => {
      await expect(
        service.createDietPlan('gym-1', 'user-1', {
          memberId: 'member-1',
          title: 'Empty Plan',
          meals: [],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates a diet plan inside a transaction and deactivates existing active plans', async () => {
      const plan = await service.createDietPlan('gym-1', 'user-1', {
        memberId: 'member-1',
        title: 'Cutting Diet',
        meals: [
          {
            mealType: 'BREAKFAST',
            name: 'Oats & Berries',
            calories: 350,
            protein: 15,
            carbs: 60,
            fats: 5,
          },
        ],
      });

      expect(prisma.dietPlan.updateMany).toHaveBeenCalledWith({
        where: { memberId: 'member-1', isActive: true },
        data: { isActive: false },
      });
      expect(prisma.dietPlan.create).toHaveBeenCalled();
      expect(plan.id).toBe('diet-1');
    });
  });

  describe('createWorkoutPlan', () => {
    it('throws BadRequestException when days array is empty', async () => {
      await expect(
        service.createWorkoutPlan('gym-1', 'user-1', {
          memberId: 'member-1',
          title: 'Empty Plan',
          days: [],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when duplicate dayOfWeek is provided', async () => {
      await expect(
        service.createWorkoutPlan('gym-1', 'user-1', {
          memberId: 'member-1',
          title: 'Duplicate Day Plan',
          days: [
            {
              dayOfWeek: 1,
              name: 'Push 1',
              exercises: [{ name: 'Bench Press', sets: 3, reps: '10' }],
            },
            {
              dayOfWeek: 1,
              name: 'Push 2',
              exercises: [{ name: 'Overhead Press', sets: 3, reps: '10' }],
            },
          ],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('creates workout plan within transaction and deactivates existing plan', async () => {
      const plan = await service.createWorkoutPlan('gym-1', 'user-1', {
        memberId: 'member-1',
        title: 'Upper/Lower Split',
        days: [
          {
            dayOfWeek: 1,
            name: 'Upper Body',
            exercises: [{ name: 'Incline Bench Press', sets: 4, reps: '8-10' }],
          },
          {
            dayOfWeek: 2,
            name: 'Lower Body',
            exercises: [{ name: 'Squats', sets: 4, reps: '8-10' }],
          },
        ],
      });

      expect(prisma.workoutPlan.updateMany).toHaveBeenCalledWith({
        where: { memberId: 'member-1', isActive: true },
        data: { isActive: false },
      });
      expect(prisma.workoutPlan.create).toHaveBeenCalled();
      expect(plan.id).toBe('workout-1');
    });
  });

  describe('progressTracking', () => {
    it('records member progress and logs audit', async () => {
      const staffUser: any = { userId: 'staff-1', gymId: 'gym-1', role: 'TRAINER' };
      const res = await service.recordProgress('gym-1', staffUser, {
        memberId: 'member-1',
        weight: 75.5,
        bodyFatPercent: 15.0,
      });

      expect(prisma.memberProgress.create).toHaveBeenCalled();
      expect(res.id).toBe('prog-1');
    });

    it('retrieves progress history for member', async () => {
      const history = await service.getProgressHistory('gym-1', 'member-1');
      expect(prisma.memberProgress.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { memberId: 'member-1' } }),
      );
      expect(history.length).toBe(1);
    });

    it('retrieves own progress history for authenticated member user', async () => {
      const history = await service.getMyProgressHistory('user-1');
      expect(prisma.member.findFirst).toHaveBeenCalledWith({
        where: { userId: 'user-1', deletedAt: null },
      });
      expect(history.length).toBe(1);
    });

    it('throws NotFoundException if member not found for getMyProgressHistory', async () => {
      prisma.member.findFirst.mockResolvedValueOnce(null);
      await expect(service.getMyProgressHistory('user-unknown')).rejects.toThrow(NotFoundException);
    });
  });
});
