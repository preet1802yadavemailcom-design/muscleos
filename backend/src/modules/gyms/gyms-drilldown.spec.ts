import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PrismaService } from '@database/prisma.service';
import { AuthService } from '@modules/auth/auth.service';
import { AuditService } from '@shared/services/audit.service';
import { AccessScopeService } from '@shared/services/access-scope.service';
import { GymsService } from './gyms.service';
import { DashboardDrillDownDto, DashboardDrillMetric } from './dto';

describe('GymsService - Dashboard DrillDown', () => {
  let service: GymsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      gymSetting: {
        findUnique: jest.fn().mockResolvedValue({ value: 'Asia/Kolkata' }),
      },
      member: {
        count: jest.fn().mockResolvedValue(42),
        findMany: jest.fn().mockResolvedValue([
          { id: 'm-1', firstName: 'John', lastName: 'Doe', memberCode: 'MOS-0001', status: 'ACTIVE' },
        ]),
      },
      membership: {
        count: jest.fn().mockResolvedValue(10),
        findMany: jest.fn().mockResolvedValue([
          { id: 'ms-1', planName: 'Gold Annual', status: 'ACTIVE', endDate: new Date() },
        ]),
      },
      attendance: {
        count: jest.fn().mockResolvedValue(15),
        findMany: jest.fn().mockResolvedValue([
          { id: 'att-1', checkInAt: new Date(), checkOutAt: null },
        ]),
      },
      payment: {
        count: jest.fn().mockResolvedValue(8),
        aggregate: jest.fn().mockResolvedValue({ _sum: { total: 50000 } }),
        findMany: jest.fn().mockResolvedValue([
          { id: 'pay-1', total: '2500', status: 'COMPLETED', createdAt: new Date() },
        ]),
      },
      batch: {
        count: jest.fn().mockResolvedValue(3),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GymsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: AuthService, useValue: {} },
        { provide: AccessScopeService, useValue: { isBranchScoped: jest.fn().mockReturnValue(false) } },
      ],
    }).compile();

    service = module.get<GymsService>(GymsService);
  });

  it('should validate and transform uppercase metric strings in DashboardDrillDownDto', async () => {
    const dto = plainToInstance(DashboardDrillDownDto, {
      metric: 'ACTIVE_MEMBERS',
      sortBy: 'createdAt',
      sortOrder: 'desc',
      page: '1',
      limit: '10',
    });

    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.metric).toBe(DashboardDrillMetric.ACTIVE_MEMBERS);
    expect(dto.sortBy).toBe('createdAt');
  });

  it('should validate alias metrics like INACTIVE_MEMBERS and EXPIRED_MEMBERS', async () => {
    const dto1 = plainToInstance(DashboardDrillDownDto, { metric: 'INACTIVE_MEMBERS' });
    const errors1 = await validate(dto1);
    expect(errors1.length).toBe(0);
    expect(dto1.metric).toBe(DashboardDrillMetric.INACTIVE_MEMBERS);

    const dto2 = plainToInstance(DashboardDrillDownDto, { metric: 'EXPIRED_MEMBERS' });
    const errors2 = await validate(dto2);
    expect(errors2.length).toBe(0);
    expect(dto2.metric).toBe(DashboardDrillMetric.EXPIRED_MEMBERS);
  });

  it('should return paginated active members for ACTIVE_MEMBERS metric', async () => {
    const res = await service.dashboardDrillDown('gym-1', {
      metric: DashboardDrillMetric.ACTIVE_MEMBERS,
      page: 1,
      limit: 10,
    });

    expect(res.metric).toBe(DashboardDrillMetric.ACTIVE_MEMBERS);
    expect(res.title).toBe('Active Members');
    expect(res.viewAllUrl).toBe('/members?status=ACTIVE');
    expect(res.data).toHaveLength(1);
    expect(res.meta.total).toBe(42);
    expect(prisma.member.findMany).toHaveBeenCalled();
  });

  it('should return inactive members for INACTIVE_MEMBERS alias metric', async () => {
    const res = await service.dashboardDrillDown('gym-1', {
      metric: DashboardDrillMetric.INACTIVE_MEMBERS,
      page: 1,
      limit: 10,
    });

    expect(res.title).toBe('Inactive Members');
    expect(res.viewAllUrl).toBe('/members?status=INACTIVE');
    expect(prisma.member.findMany).toHaveBeenCalled();
  });

  it('should return expired members for EXPIRED_MEMBERS alias metric', async () => {
    const res = await service.dashboardDrillDown('gym-1', {
      metric: DashboardDrillMetric.EXPIRED_MEMBERS,
      page: 1,
      limit: 10,
    });

    expect(res.title).toBe('Expired Members');
    expect(res.viewAllUrl).toBe('/members?status=EXPIRED');
    expect(prisma.member.findMany).toHaveBeenCalled();
  });

  it('should return expired memberships for EXPIRED_MEMBERSHIPS metric with OR query', async () => {
    const res = await service.dashboardDrillDown('gym-1', {
      metric: DashboardDrillMetric.EXPIRED_MEMBERSHIPS,
      page: 1,
      limit: 10,
    });

    expect(res.metric).toBe(DashboardDrillMetric.EXPIRED_MEMBERSHIPS);
    expect(res.title).toBe('Expired Memberships');
    expect(res.viewAllUrl).toBe('/memberships?status=EXPIRED');
    expect(prisma.membership.findMany).toHaveBeenCalled();
  });

  it('should return paginated check-ins for CHECKINS_TODAY metric', async () => {
    const res = await service.dashboardDrillDown('gym-1', {
      metric: DashboardDrillMetric.CHECKINS_TODAY,
      page: 1,
      limit: 10,
    });

    expect(res.metric).toBe(DashboardDrillMetric.CHECKINS_TODAY);
    expect(res.title).toBe("Today's Check-ins");
    expect(res.viewAllUrl).toBe('/attendance?date=today&event=CHECK_IN');
    expect(res.data).toHaveLength(1);
    expect(prisma.attendance.findMany).toHaveBeenCalled();
  });

  it('should return paginated check-outs for CHECKOUTS_TODAY metric', async () => {
    const res = await service.dashboardDrillDown('gym-1', {
      metric: DashboardDrillMetric.CHECKOUTS_TODAY,
      page: 1,
      limit: 10,
    });

    expect(res.metric).toBe(DashboardDrillMetric.CHECKOUTS_TODAY);
    expect(res.title).toBe("Today's Check-outs");
    expect(res.viewAllUrl).toBe('/attendance?date=today&event=CHECK_OUT');
  });

  it('should return live attendees for CURRENTLY_IN_GYM metric', async () => {
    const res = await service.dashboardDrillDown('gym-1', {
      metric: DashboardDrillMetric.CURRENTLY_IN_GYM,
      page: 1,
      limit: 10,
    });

    expect(res.metric).toBe(DashboardDrillMetric.CURRENTLY_IN_GYM);
    expect(res.title).toBe('Currently In Gym');
    expect(res.viewAllUrl).toBe('/attendance?status=OPEN');
  });

  it('should return expiring memberships for EXPIRING_SOON metric', async () => {
    const res = await service.dashboardDrillDown('gym-1', {
      metric: DashboardDrillMetric.EXPIRING_SOON,
      page: 1,
      limit: 10,
    });

    expect(res.metric).toBe(DashboardDrillMetric.EXPIRING_SOON);
    expect(res.viewAllUrl).toBe('/memberships?expiry=within_7_days');
    expect(prisma.membership.findMany).toHaveBeenCalled();
  });

  it('should return revenue records for REVENUE_TODAY metric', async () => {
    const res = await service.dashboardDrillDown('gym-1', {
      metric: DashboardDrillMetric.REVENUE_TODAY,
      page: 1,
      limit: 10,
    });

    expect(res.metric).toBe(DashboardDrillMetric.REVENUE_TODAY);
    expect(res.viewAllUrl).toBe('/payments?range=today&status=SUCCESS');
    expect(prisma.payment.findMany).toHaveBeenCalled();
  });

  it('should return revenue records for REVENUE_MONTH metric', async () => {
    const res = await service.dashboardDrillDown('gym-1', {
      metric: DashboardDrillMetric.REVENUE_MONTH,
      page: 1,
      limit: 10,
    });

    expect(res.metric).toBe(DashboardDrillMetric.REVENUE_MONTH);
    expect(res.viewAllUrl).toBe('/payments?range=this_month&status=SUCCESS');
  });

  it('should compute consistent dashboardStats', async () => {
    const stats = await service.dashboardStats('gym-1');

    expect(stats.members.active).toBe(42);
    expect(stats.attendance.checkInsToday).toBe(15);
    expect(stats.attendance.currentlyInGym).toBe(15);
    expect(stats.revenue.total).toBe(50000);
  });
});
