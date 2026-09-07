import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { MembershipStatus, AttendanceType, AttendanceStatus, Prisma } from '@prisma/client';
import { AuditService } from '@shared/services/audit.service';

import { AttendanceCoreService } from './attendance-core.service';

describe('AttendanceCoreService Concurrency & Safety', () => {
  let core: AttendanceCoreService;
  let prisma: any;
  let audit: any;
  let redis: any;

  const validMember = {
    id: 'mem-100',
    gymId: 'gym-1',
    batchId: 'batch-1',
    batch: { id: 'batch-1', name: 'General Batch', days: [] },
    currentMembership: {
      id: 'ms-1',
      status: MembershipStatus.ACTIVE,
      endDate: new Date(Date.now() + 86400000 * 30),
    },
  };

  beforeEach(() => {
    prisma = {
      attendance: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      member: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    audit = {
      log: jest.fn().mockResolvedValue({}),
    };

    redis = {
      publish: jest.fn().mockResolvedValue(1),
    };

    core = new AttendanceCoreService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      redis as unknown as RedisService,
    );
  });

  describe('Strict Membership Pre-Validation', () => {
    it('rejects check-in immediately if member has no assigned batch', async () => {
      const input: any = {
        member: { ...validMember, batchId: null, batch: null },
        gymId: 'gym-1',
        source: 'SELF',
      };

      await expect(core.recordScan(input)).rejects.toThrow(
        new ForbiddenException('No batch assigned — attendance not permitted without an assigned batch.'),
      );
      expect(prisma.attendance.create).not.toHaveBeenCalled();
    });

    it('rejects check-in if attendance was already completed today', async () => {
      prisma.attendance.findFirst.mockResolvedValueOnce({
        id: 'completed-today-1',
        memberId: validMember.id,
        checkInAt: new Date(),
        checkOutAt: new Date(),
      });

      const input: any = {
        member: validMember,
        gymId: 'gym-1',
        source: 'SELF',
      };

      await expect(core.recordScan(input)).rejects.toThrow(
        new BadRequestException('Attendance already completed for today.'),
      );
      expect(prisma.attendance.create).not.toHaveBeenCalled();
    });

    it('rejects check-in immediately if member has no currentMembership', async () => {
      const input: any = {
        member: { ...validMember, currentMembership: null },
        gymId: 'gym-1',
        source: 'SELF',
      };

      await expect(core.recordScan(input)).rejects.toThrow(
        new ForbiddenException('No active membership found for this member.'),
      );
      expect(prisma.attendance.create).not.toHaveBeenCalled();
    });

    it('rejects check-in immediately if membership is FROZEN', async () => {
      const input: any = {
        member: {
          ...validMember,
          currentMembership: { ...validMember.currentMembership, status: MembershipStatus.FROZEN },
        },
        gymId: 'gym-1',
        source: 'SELF',
      };

      await expect(core.recordScan(input)).rejects.toThrow(
        new ForbiddenException('Membership is currently frozen.'),
      );
      expect(prisma.attendance.create).not.toHaveBeenCalled();
    });

    it('rejects check-in immediately if membership is EXPIRED', async () => {
      const input: any = {
        member: {
          ...validMember,
          currentMembership: { ...validMember.currentMembership, status: MembershipStatus.EXPIRED },
        },
        gymId: 'gym-1',
        source: 'SELF',
      };

      await expect(core.recordScan(input)).rejects.toThrow(
        new ForbiddenException('Membership has expired — please renew to check in.'),
      );
      expect(prisma.attendance.create).not.toHaveBeenCalled();
    });
  });

  describe('Concurrent Check-in Race Handling via Promise.all', () => {
    it('handles concurrent check-ins: first acquires open session, second detects race and converts cleanly', async () => {
      const input: any = {
        member: validMember,
        gymId: 'gym-1',
        source: 'SELF',
        performedBy: 'user-1',
      };

      const now = new Date();
      const session1 = {
        id: 'att-1',
        memberId: 'mem-100',
        type: AttendanceType.CHECK_IN,
        status: AttendanceStatus.PRESENT,
        checkInAt: now,
        checkOutAt: null,
      };

      // Call 1 succeeds in creating attendance session
      // Call 2 throws P2002 on attendance_one_open_session_per_member
      const p2002Error = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the fields: (memberId) where checkOutAt IS NULL',
        {
          code: 'P2002',
          clientVersion: '5.8.0',
          meta: { target: ['attendance_one_open_session_per_member'] },
        },
      );

      let createCalls = 0;
      prisma.attendance.create.mockImplementation(() => {
        createCalls++;
        if (createCalls === 1) {
          return Promise.resolve(session1);
        }
        return Promise.reject(p2002Error);
      });

      // When Call 2 catches P2002, it looks up the open session and closes it
      prisma.attendance.findFirst.mockImplementation(({ where }: any) => {
        if (where?.checkOutAt === null) {
          return Promise.resolve(session1);
        }
        return Promise.resolve(null);
      });

      prisma.attendance.updateMany.mockResolvedValue({ count: 1 });
      prisma.attendance.findUniqueOrThrow.mockResolvedValue({
        ...session1,
        type: AttendanceType.CHECK_OUT,
        checkOutAt: new Date(now.getTime() + 3600000),
      });

      const [res1, res2] = await Promise.all([
        core.recordScan(input),
        core.recordScan(input),
      ]);

      expect(res1.type).toBe(AttendanceType.CHECK_IN);
      expect(res2.type).toBe(AttendanceType.CHECK_OUT);
      expect(prisma.attendance.create).toHaveBeenCalledTimes(2);
    });

    it('prevents double checkout on concurrent checkout requests for the same session', async () => {
      const input: any = {
        member: validMember,
        gymId: 'gym-1',
        source: 'SELF',
      };

      const openSession = {
        id: 'att-open-1',
        memberId: 'mem-100',
        checkInAt: new Date(Date.now() - 3600000),
        checkOutAt: null,
      };

      // Direct call to closeOpenSessionInternal with concurrent requests
      prisma.attendance.findFirst.mockResolvedValue(openSession);

      // First updateMany succeeds with count 1; second returns count 0 (already checked out)
      let updateCount = 0;
      prisma.attendance.updateMany.mockImplementation(() => {
        updateCount++;
        return Promise.resolve({ count: updateCount === 1 ? 1 : 0 });
      });

      prisma.attendance.findUniqueOrThrow.mockResolvedValue({
        ...openSession,
        checkOutAt: new Date(),
        type: AttendanceType.CHECK_OUT,
      });

      const call1 = core.closeOpenSession(input);
      const call2 = core.closeOpenSession(input);

      const results = await Promise.allSettled([call1, call2]);

      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('rejected');
      if (results[1].status === 'rejected') {
        expect(results[1].reason).toBeInstanceOf(BadRequestException);
        expect((results[1].reason as Error).message).toContain(
          'This session was already checked out by another request.',
        );
      }
    });
  });
});
