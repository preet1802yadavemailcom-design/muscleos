import { Test, TestingModule } from '@nestjs/testing';
import { ReceptionService } from './reception.service';
import { PrismaService } from '@database/prisma.service';
import { MembersService } from '@modules/members/members.service';
import { PaymentsService } from '@modules/payments/payments.service';
import { AttendanceService } from '@modules/attendance/attendance.service';
import { MembershipsService } from '@modules/memberships/memberships.service';

describe('ReceptionService', () => {
  let service: ReceptionService;
  let prisma: any;
  let attendance: any;

  beforeEach(async () => {
    prisma = {
      attendance: { count: jest.fn(), findMany: jest.fn() },
      membership: { count: jest.fn() },
      payment: { count: jest.fn(), findMany: jest.fn() },
      member: { count: jest.fn(), findMany: jest.fn() },
      batch: { findMany: jest.fn() },
    };

    attendance = {
      getGymTimezone: jest.fn().mockResolvedValue('Asia/Kolkata'),
      liveFeed: jest.fn(),
      memberHistory: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReceptionService,
        { provide: PrismaService, useValue: prisma },
        { provide: MembersService, useValue: { create: jest.fn(), findAll: jest.fn() } },
        { provide: PaymentsService, useValue: { initiate: jest.fn(), downloadReceipt: jest.fn() } },
        { provide: AttendanceService, useValue: attendance },
        { provide: MembershipsService, useValue: { renew: jest.fn() } },
      ],
    }).compile();

    service = module.get<ReceptionService>(ReceptionService);
  });

  describe('dashboard', () => {
    it('queries timezone-aware metrics for today', async () => {
      prisma.attendance.count.mockResolvedValueOnce(25).mockResolvedValueOnce(10);
      prisma.membership.count.mockResolvedValueOnce(5);
      prisma.payment.count.mockResolvedValueOnce(3);
      prisma.member.count.mockResolvedValueOnce(120);

      const result = await service.dashboard('gym-1');

      expect(attendance.getGymTimezone).toHaveBeenCalledWith('gym-1');
      expect(result).toEqual({
        todayCheckIns: 25,
        currentlyInGym: 10,
        expiringSoon: 5,
        pendingPayments: 3,
        activeMembers: 120,
      });

      // Check attendanceWhere passed to count
      const attendanceCall = prisma.attendance.count.mock.calls[0][0];
      expect(attendanceCall.where.gymId).toBe('gym-1');
      expect(attendanceCall.where.checkInAt).toBeDefined();
    });

    it('scopes all metrics by batchId when provided', async () => {
      prisma.attendance.count.mockResolvedValueOnce(12).mockResolvedValueOnce(4);
      prisma.membership.count.mockResolvedValueOnce(2);
      prisma.payment.count.mockResolvedValueOnce(1);
      prisma.member.count.mockResolvedValueOnce(30);

      const result = await service.dashboard('gym-1', 'batch-123');

      expect(result.todayCheckIns).toBe(12);
      expect(prisma.attendance.count.mock.calls[0][0].where.batchId).toBe('batch-123');
      expect(prisma.attendance.count.mock.calls[1][0].where.batchId).toBe('batch-123');
      expect(prisma.membership.count.mock.calls[0][0].where.member).toEqual({ batchId: 'batch-123' });
      expect(prisma.payment.count.mock.calls[0][0].where.member).toEqual({ batchId: 'batch-123' });
      expect(prisma.member.count.mock.calls[0][0].where.batchId).toBe('batch-123');
    });
  });

  describe('getCheckinsToday', () => {
    it('filters by timezone boundaries, batch, and search query', async () => {
      prisma.attendance.findMany.mockResolvedValueOnce([
        { id: 'att-1', checkInAt: new Date(), member: { firstName: 'John' } },
      ]);

      const result = await service.getCheckinsToday('gym-1', 'batch-1', 'John');

      expect(attendance.getGymTimezone).toHaveBeenCalledWith('gym-1');
      expect(result).toHaveLength(1);
      const call = prisma.attendance.findMany.mock.calls[0][0];
      expect(call.where.gymId).toBe('gym-1');
      expect(call.where.batchId).toBe('batch-1');
      expect(call.where.member.OR).toBeDefined();
    });
  });

  describe('getExpiringMembers', () => {
    it('uses canonical end-of-day threshold for expiring memberships', async () => {
      prisma.member.findMany.mockResolvedValueOnce([
        { id: 'mem-1', firstName: 'Alice', currentMembership: { endDate: new Date() } },
      ]);

      const result = await service.getExpiringMembers('gym-1', undefined, 7);

      expect(attendance.getGymTimezone).toHaveBeenCalledWith('gym-1');
      expect(result).toHaveLength(1);
      const call = prisma.member.findMany.mock.calls[0][0];
      expect(call.where.currentMembership.is.status).toBe('ACTIVE');
      expect(call.where.currentMembership.is.endDate.lte).toBeInstanceOf(Date);
    });
  });
});
