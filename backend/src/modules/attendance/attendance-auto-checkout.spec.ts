import { PrismaService } from '@database/prisma.service';
import { Test } from '@nestjs/testing';
import { AttendanceService } from './attendance.service';
import { AttendanceCoreService } from './attendance-core.service';
import { QrService } from '@modules/qr/qr.service';
import { AuditService } from '@shared/services/audit.service';
import { EncryptionService } from '@shared/services/encryption.service';
import { SequenceService } from '@shared/services/sequence.service';
import { RedisService } from '@database/redis.service';
import { getZonedDateParts } from '@common/utils/timezone.util';

describe('AttendanceService - Auto Checkout', () => {
  let service: AttendanceService;
  let prisma: any;
  let redis: any;

  beforeEach(async () => {
    prisma = {
      attendance: {
        findMany: jest.fn(),
        updateMany: jest.fn(),
      },
      gymSetting: {
        findUnique: jest.fn().mockResolvedValue({ value: 'Asia/Kolkata' }),
      },
    };

    redis = {
      publish: jest.fn().mockResolvedValue(undefined),
      setNx: jest.fn().mockResolvedValue(true),
    };

    const module = await Test.createTestingModule({
      providers: [
        AttendanceService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: EncryptionService, useValue: {} },
        { provide: AttendanceCoreService, useValue: {} },
        { provide: QrService, useValue: {} },
        { provide: SequenceService, useValue: {} },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    service = module.get(AttendanceService);
  });

  it('automatically closes open sessions past batch endTime with BATCH_END reason', async () => {
    // Check in was 4 hours ago, batch ended 2 hours ago
    const checkInTime = new Date(Date.now() - 4 * 60 * 60 * 1000);
    const endTimeRef = new Date(Date.now() - 2 * 60 * 60 * 1000);

    const checkInParts = getZonedDateParts(checkInTime, 'Asia/Kolkata');
    const endParts = getZonedDateParts(endTimeRef, 'Asia/Kolkata');

    const startH = String(checkInParts.hour).padStart(2, '0');
    const startM = String(checkInParts.minute).padStart(2, '0');
    const endH = String(endParts.hour).padStart(2, '0');
    const endM = String(endParts.minute).padStart(2, '0');

    const openSession = {
      id: 'session-batch-1',
      gymId: 'gym-1',
      checkInAt: checkInTime,
      checkOutAt: null,
      batch: {
        id: 'batch-morning',
        name: 'Morning Batch',
        startTime: `${startH}:${startM}`,
        endTime: `${endH}:${endM}`,
      },
      member: {
        id: 'mem-1',
        firstName: 'Aarav',
        lastName: 'Patel',
        memberCode: 'MEM-001',
      },
    };

    prisma.attendance.findMany.mockResolvedValue([openSession]);
    prisma.attendance.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.autoCheckoutOpenSessions('gym-1');

    expect(result.closedCount).toBe(1);
    expect(prisma.attendance.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'session-batch-1', checkOutAt: null },
        data: expect.objectContaining({
          isAutoClosed: true,
          autoCloseReason: 'BATCH_END',
        }),
      }),
    );
    expect(redis.publish).toHaveBeenCalledWith(
      'attendance:gym-1',
      expect.stringContaining('BATCH_END'),
    );
  });

  it('automatically closes stale sessions without batch (>12h) with STALE_SESSION reason', async () => {
    const checkInTime = new Date(Date.now() - 13 * 60 * 60 * 1000); // 13h ago
    const staleSession = {
      id: 'session-stale-1',
      gymId: 'gym-1',
      checkInAt: checkInTime,
      checkOutAt: null,
      batch: null,
      member: {
        id: 'mem-2',
        firstName: 'Pooja',
        lastName: 'Sharma',
        memberCode: 'MEM-002',
      },
    };

    prisma.attendance.findMany.mockResolvedValue([staleSession]);
    prisma.attendance.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.autoCheckoutOpenSessions('gym-1');

    expect(result.closedCount).toBe(1);
    expect(prisma.attendance.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'session-stale-1', checkOutAt: null },
        data: expect.objectContaining({
          isAutoClosed: true,
          autoCloseReason: 'STALE_SESSION',
        }),
      }),
    );
  });
});
