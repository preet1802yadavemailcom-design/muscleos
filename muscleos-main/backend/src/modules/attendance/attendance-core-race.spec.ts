import { Prisma } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@database/prisma.service';
import { AuditService } from '@shared/services/audit.service';
import { RedisService } from '@database/redis.service';

import { AttendanceCoreService } from './attendance-core.service';

/**
 * Regression coverage for the check-in race condition found+fixed this
 * session: the OLD logic was "read whether a session is open, then decide
 * insert-vs-update" — two concurrent scans could both read "no open
 * session" before either committed, producing two open CHECK_IN rows for
 * the same member. The fix is a DB-level partial unique index
 * (attendance_one_open_session_per_member migration) plus this
 * attempt-insert-first-then-catch-conflict pattern, which these tests
 * target directly (mocking the P2002 the DB would raise) since the
 * sandbox can't run a real concurrent-Postgres test.
 */
describe('AttendanceCoreService — race-condition handling', () => {
  let service: AttendanceCoreService;
  let prisma: any;

  const member = {
    id: 'member-1', firstName: 'Rohit', lastName: 'Sharma', memberCode: 'MUS-1',
    batchId: null, batch: null, currentMembership: null,
  };
  const gymId = 'gym-1';

  function uniqueViolation() {
    // Mirrors what Prisma actually throws for a unique-constraint hit —
    // isOpenSessionConflict() matches on error.code === 'P2002'.
    return Object.assign(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.8.0' }),
      { meta: { target: ['attendance_one_open_session_per_member'] } },
    );
  }

  beforeEach(async () => {
    prisma = {
      attendance: {
        findFirst: jest.fn().mockResolvedValue(null), // no "very recent" duplicate scan by default
        create: jest.fn(),
        update: jest.fn(),
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        AttendanceCoreService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: RedisService, useValue: { publish: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();

    service = module.get(AttendanceCoreService);
  });

  it('creates a CHECK_IN row when no session is open', async () => {
    prisma.attendance.create.mockResolvedValue({
      id: 'att-1', checkInAt: new Date(), checkOutAt: null, type: 'CHECK_IN', status: 'PRESENT',
    });

    const result = await service.recordScan({ member, gymId, source: 'QR' as any });

    expect(prisma.attendance.create).toHaveBeenCalledTimes(1);
    expect(prisma.attendance.update).not.toHaveBeenCalled();
    expect(result.type).toBe('CHECK_IN');
  });

  it('on a unique-constraint conflict (session already open), closes the existing open session instead of erroring', async () => {
    prisma.attendance.create.mockRejectedValue(uniqueViolation());
    const openSession = { id: 'att-open', checkInAt: new Date(Date.now() - 3600_000) };
    // The conflict-recovery path re-reads the open session to close it.
    prisma.attendance.findFirst
      .mockResolvedValueOnce(null) // duplicate-scan guard check inside attemptCheckIn
      .mockResolvedValueOnce(openSession); // closeOpenSessionInternal's lookup
    prisma.attendance.update.mockResolvedValue({
      id: 'att-open', checkInAt: openSession.checkInAt, checkOutAt: new Date(), type: 'CHECK_OUT',
    });

    const result = await service.recordScan({ member, gymId, source: 'QR' as any });

    expect(prisma.attendance.update).toHaveBeenCalledTimes(1);
    expect(result.type).toBe('CHECK_OUT');
  });

  it('re-throws any error that is NOT the specific open-session conflict', async () => {
    const otherError = new Error('database is on fire');
    prisma.attendance.create.mockRejectedValue(otherError);

    await expect(service.recordScan({ member, gymId, source: 'QR' as any })).rejects.toThrow('database is on fire');
    expect(prisma.attendance.update).not.toHaveBeenCalled();
  });

  it('publishes to the gym-scoped Redis channel for real-time dashboard updates, without failing the request if the publish itself fails', async () => {
    prisma.attendance.create.mockResolvedValue({
      id: 'att-1', checkInAt: new Date(), checkOutAt: null, type: 'CHECK_IN', status: 'PRESENT',
    });
    const redis = { publish: jest.fn().mockRejectedValue(new Error('redis down')) };
    const module = await Test.createTestingModule({
      providers: [
        AttendanceCoreService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();
    const svc = module.get(AttendanceCoreService);

    await expect(svc.recordScan({ member, gymId, source: 'QR' as any })).resolves.toBeDefined();
    expect(redis.publish).toHaveBeenCalledWith(`attendance:${gymId}`, expect.any(String));
  });
});
