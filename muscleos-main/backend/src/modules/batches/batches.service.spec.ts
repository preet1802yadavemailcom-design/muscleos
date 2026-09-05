import { PrismaService } from '@database/prisma.service';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuditService } from '@shared/services/audit.service';

import { BatchesService } from './batches.service';


describe('BatchesService', () => {
  let service: BatchesService;
  let prisma: any;

  const gymId = 'gym-1';

  beforeEach(async () => {
    prisma = {
      batch: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        BatchesService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { log: jest.fn() } },
      ],
    }).compile();

    service = module.get(BatchesService);
  });

  describe('create', () => {
    const baseDto = {
      name: 'Morning Yoga',
      type: 'YOGA',
      startTime: '06:00',
      endTime: '07:00',
      days: ['mon', 'wed', 'fri'],
      capacity: 20,
      trainerId: 'trainer-1',
    } as any;

    it('rejects when startTime is not before endTime', async () => {
      await expect(
        service.create(gymId, { ...baseDto, startTime: '08:00', endTime: '07:00' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects invalid day codes', async () => {
      await expect(
        service.create(gymId, { ...baseDto, days: ['mon', 'FUNDAY'] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('throws ConflictException when the same trainer has an overlapping batch', async () => {
      prisma.batch.findMany.mockResolvedValue([
        { id: 'other-batch', name: 'Existing Batch', startTime: '06:30', endTime: '07:30', days: ['MON'] },
      ]);

      await expect(service.create(gymId, baseDto)).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.batch.create).not.toHaveBeenCalled();
    });

    it('creates the batch and writes an audit log when there is no conflict', async () => {
      prisma.batch.findMany.mockResolvedValue([
        { id: 'other-batch', name: 'Existing Batch', startTime: '09:00', endTime: '10:00', days: ['MON'] },
      ]);
      prisma.batch.create.mockResolvedValue({ id: 'new-batch', ...baseDto, gymId });

      const result = await service.create(gymId, baseDto);

      expect(result.id).toBe('new-batch');
      expect(prisma.batch.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ gymId, days: ['MON', 'WED', 'FRI'] }) }),
      );
    });

    it('does not conflict-check when no trainer is assigned', async () => {
      prisma.batch.create.mockResolvedValue({ id: 'new-batch', ...baseDto, trainerId: undefined, gymId });

      await service.create(gymId, { ...baseDto, trainerId: undefined });

      expect(prisma.batch.findMany).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException when the batch does not exist for the gym', async () => {
      prisma.batch.findFirst.mockResolvedValue(null);
      await expect(service.findOne('missing-id', gymId)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns the batch when found', async () => {
      const batch = { id: 'b1', gymId, name: 'Evening CrossFit' };
      prisma.batch.findFirst.mockResolvedValue(batch);
      await expect(service.findOne('b1', gymId)).resolves.toEqual(batch);
    });
  });
});
