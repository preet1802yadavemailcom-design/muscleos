import { PrismaService } from '@database/prisma.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ReportType, ReportPeriod, PaymentStatus, PaymentGateway, PaymentMethod } from '@prisma/client';
import { AccessScopeService } from '@shared/services/access-scope.service';
import { AuditService } from '@shared/services/audit.service';
import { ExportService } from '@shared/services/export.service';

import { ReportsService } from './reports.service';


describe('ReportsService', () => {
  let service: ReportsService;
  let prisma: any;
  let accessScope: any;

  beforeEach(async () => {
    prisma = {
      report: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'rep-1', ...data })),
        delete: jest.fn().mockResolvedValue({ id: 'rep-1' }),
      },
      attendance: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      payment: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      member: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      batch: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      membership: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    accessScope = {
      isBranchScoped: jest.fn().mockReturnValue(false),
      getBranchId: jest.fn().mockReturnValue('b-10'),
      assertBranchAccess: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: ExportService, useValue: { toPdf: jest.fn(), toExcel: jest.fn(), toCsv: jest.fn() } },
        { provide: AccessScopeService, useValue: accessScope },
      ],
    }).compile();

    service = module.get(ReportsService);
  });

  describe('resolveRange', () => {
    it('throws BadRequestException if CUSTOM period is specified without dates', () => {
      expect(() => service.resolveRange(ReportPeriod.CUSTOM)).toThrow(BadRequestException);
    });

    it('resolves CUSTOM period correctly', () => {
      const range = service.resolveRange(ReportPeriod.CUSTOM, '2026-01-01', '2026-01-31');
      expect(range.startDate).toEqual(new Date('2026-01-01'));
      expect(range.endDate).toEqual(new Date('2026-01-31'));
    });
  });

  describe('revenueReport', () => {
    it('calculates grossRevenue, totalRefunds, netRevenue, pending, failed accurately', async () => {
      const mockPayments = [
        {
          id: 'p1',
          total: 1000,
          discount: 100,
          tax: 180,
          refundedAmount: 200,
          status: 'COMPLETED',
          gateway: 'RAZORPAY',
          method: 'ONLINE',
          receiptNumber: 'REC-001',
          createdAt: new Date('2026-03-01T10:00:00Z'),
          member: { firstName: 'Alice', lastName: 'Smith', branchId: 'b1' },
        },
        {
          id: 'p2',
          total: 500,
          discount: 0,
          tax: 90,
          refundedAmount: 500,
          status: 'REFUNDED',
          gateway: 'CASH',
          method: 'CASH',
          receiptNumber: 'REC-002',
          createdAt: new Date('2026-03-02T11:00:00Z'),
          member: { firstName: 'Bob', lastName: 'Jones', branchId: 'b1' },
        },
        {
          id: 'p3',
          total: 300,
          discount: 0,
          tax: 0,
          refundedAmount: 0,
          status: 'PENDING',
          gateway: 'UPI',
          method: 'UPI',
          receiptNumber: 'REC-003',
          createdAt: new Date('2026-03-03T12:00:00Z'),
          member: null,
        },
        {
          id: 'p4',
          total: 400,
          discount: 0,
          tax: 0,
          refundedAmount: 0,
          status: 'FAILED',
          gateway: 'RAZORPAY',
          method: 'ONLINE',
          receiptNumber: 'REC-004',
          createdAt: new Date('2026-03-04T12:00:00Z'),
          member: null,
        },
      ];

      prisma.payment.findMany.mockResolvedValue(mockPayments);

      const report = await service.generate(
        'gym-1',
        'user-1',
        ReportType.REVENUE,
        ReportPeriod.CUSTOM,
        '2026-03-01',
        '2026-03-31',
      );

      const summary = report.summary as any;
      // gross revenue: completed (1000) + refunded (500) = 1500
      expect(summary.grossRevenue).toBe(1500);
      // total refunds: 200 + 500 = 700
      expect(summary.totalRefunds).toBe(700);
      // net revenue: 1500 - 700 = 800
      expect(summary.netRevenue).toBe(800);
      // pending amount: 300
      expect(summary.pendingAmount).toBe(300);
      // failed amount: 400
      expect(summary.failedAmount).toBe(400);
      expect(summary.transactionCount).toBe(2);
      expect(summary.pendingCount).toBe(1);
      expect(summary.failedCount).toBe(1);
    });

    it('enforces branch scoping on revenue query for branch-scoped users', async () => {
      const branchUser: any = { userId: 'mgr-1', gymId: 'gym-1', role: 'BRANCH_MANAGER', branchId: 'b-10' };
      accessScope.isBranchScoped.mockReturnValue(true);
      accessScope.getBranchId.mockReturnValue('b-10');

      await service.generate(
        'gym-1',
        'mgr-1',
        ReportType.REVENUE,
        ReportPeriod.CUSTOM,
        '2026-03-01',
        '2026-03-31',
        branchUser,
      );

      expect(prisma.payment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            gymId: 'gym-1',
            member: { branchId: 'b-10' },
          }),
        }),
      );
    });
  });
});
