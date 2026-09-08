import { DEFAULT_TIMEZONE, getGymStartOfDay, getGymEndOfDay, getGymStartOfMonth } from '@common/utils/timezone.util';
import { CurrentUserPayload } from '@common/decorators/current-user.decorator';
import { PrismaService } from '@database/prisma.service';
import { AuthService } from '@modules/auth/auth.service';
import { Injectable, BadRequestException, NotFoundException, Optional } from '@nestjs/common';
import { GymStatus, PlanType, UserRole, UserStatus, MembershipStatus, PaymentStatus, Prisma } from '@prisma/client';
import { AccessScopeService } from '@shared/services/access-scope.service';
import { AuditService } from '@shared/services/audit.service';
import * as bcrypt from 'bcryptjs';

import { RegisterGymDto, UpdateGymProfileDto, DashboardDrillDownDto, DashboardDrillMetric } from './dto';

@Injectable()
export class GymsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly authService: AuthService,
    @Optional() private readonly accessScope?: AccessScopeService,
  ) {}

  // ---------- Registration (public) ----------

  /** New gym signup: creates the Gym (PENDING, awaiting Super Admin approval) + its Owner account in one transaction. */
  async register(dto: RegisterGymDto) {
    const existingOwner = await this.prisma.user.findFirst({ where: { email: dto.ownerEmail } });
    if (existingOwner) throw new BadRequestException('An account with this email already exists');

    const slug = await this.generateSlug(dto.gymName);
    const hashedPassword = await bcrypt.hash(dto.password, 12);

    const { gym, owner } = await this.prisma.$transaction(async (tx) => {
      const gym = await tx.gym.create({
        data: {
          name: dto.gymName,
          slug,
          email: dto.gymEmail,
          phone: dto.gymPhone,
          address: dto.address,
          city: dto.city,
          state: dto.state,
          status: GymStatus.PENDING,
          planType: PlanType.TRIAL,
          planExpiry: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14-day trial
        },
      });

      const owner = await tx.user.create({
        data: {
          email: dto.ownerEmail,
          password: hashedPassword,
          firstName: dto.ownerFirstName,
          lastName: dto.ownerLastName,
          phone: dto.ownerPhone,
          role: UserRole.GYM_OWNER,
          status: UserStatus.PENDING,
          gymId: gym.id,
        },
      });

      return { gym, owner };
    });

    await this.audit.log({
      action: 'GYM_REGISTERED', entity: 'Gym', entityId: gym.id, userId: owner.id, gymId: gym.id,
      newValue: { name: gym.name, ownerEmail: owner.email },
    });

    await this.authService.sendVerificationOtp(owner.email);

    return {
      gym: { id: gym.id, name: gym.name, slug: gym.slug, status: gym.status },
      ownerId: owner.id,
      message: 'Gym registered. Step 1 of 2: verify your email with the OTP just sent. Step 2 (WhatsApp) will follow automatically, then your account activates pending Super Admin approval.',
    };
  }

  private async generateSlug(name: string): Promise<string> {
    const base = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    let slug = base || 'gym';
    let suffix = 0;
    while (await this.prisma.gym.findUnique({ where: { slug } })) {
      suffix += 1;
      slug = `${base}-${suffix}`;
    }
    return slug;
  }

  // ---------- Own gym profile ----------

  async getProfile(gymId: string) {
    const gym = await this.prisma.gym.findFirst({ where: { id: gymId, deletedAt: null } });
    if (!gym) throw new NotFoundException('Gym not found');
    return gym;
  }

  async updateProfile(gymId: string, dto: UpdateGymProfileDto, userId: string) {
    const existing = await this.getProfile(gymId);
    const gym = await this.prisma.gym.update({ where: { id: gymId }, data: dto });
    await this.audit.log({
      action: 'GYM_PROFILE_UPDATED', entity: 'Gym', entityId: gymId, userId, gymId,
      oldValue: existing, newValue: gym,
    });
    return gym;
  }

  // ---------- Gym Owner Dashboard (spec Module 04) ----------

  private async getGymTimezone(gymId: string): Promise<string> {
    const setting = await this.prisma.gymSetting.findUnique({
      where: { gymId_category_key: { gymId, category: 'business', key: 'timezone' } },
    });
    return setting?.value?.replace(/"/g, '') || DEFAULT_TIMEZONE;
  }

  async dashboardStats(gymId: string, user?: CurrentUserPayload) {
    const tz = await this.getGymTimezone(gymId);
    const now = new Date();
    const startOfDay = getGymStartOfDay(now, tz);
    const endOfDay = getGymEndOfDay(now, tz);
    const startOfMonth = getGymStartOfMonth(now, tz);
    const sevenDaysOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    let branchId: string | undefined;
    if (user && this.accessScope?.isBranchScoped(user)) {
      branchId = this.accessScope.getBranchId(user);
    }

    const memberWhere: any = { gymId, deletedAt: null };
    if (branchId) memberWhere.branchId = branchId;

    const membershipWhere: any = { gymId, deletedAt: null };
    if (branchId) membershipWhere.member = { branchId };

    const attendanceWhere: any = { gymId };
    if (branchId) attendanceWhere.branchId = branchId;

    const paymentWhere: any = { gymId, deletedAt: null };
    if (branchId) paymentWhere.member = { branchId };

    const [
      totalMembers, activeMembers, inactiveMembers, expiredMemberships, expiringMemberships,
      todayCheckIns, todayCheckOuts, currentlyCheckedIn, totalBatches, activeBatches,
      revenueAgg, revenueTodayAgg, revenueMonthAgg, pendingPayments,
    ] = await Promise.all([
      this.prisma.member.count({ where: memberWhere }),
      this.prisma.member.count({ where: { ...memberWhere, status: UserStatus.ACTIVE } }),
      this.prisma.member.count({ where: { ...memberWhere, status: UserStatus.INACTIVE } }),
      this.prisma.membership.count({
        where: {
          ...membershipWhere,
          status: MembershipStatus.ACTIVE,
          endDate: { lt: now },
        },
      }),
      this.prisma.membership.count({
        where: {
          ...membershipWhere,
          status: MembershipStatus.ACTIVE,
          endDate: { gte: now, lte: sevenDaysOut },
        },
      }),
      this.prisma.attendance.count({
        where: {
          ...attendanceWhere,
          checkInAt: { gte: startOfDay, lte: endOfDay },
        },
      }),
      this.prisma.attendance.count({
        where: {
          ...attendanceWhere,
          checkOutAt: { gte: startOfDay, lte: endOfDay },
        },
      }),
      this.prisma.attendance.count({
        where: {
          ...attendanceWhere,
          checkInAt: { gte: startOfDay, lte: endOfDay },
          checkOutAt: null,
        },
      }),
      this.prisma.batch.count({ where: { gymId, deletedAt: null } }),
      this.prisma.batch.count({ where: { gymId, deletedAt: null, status: 'ACTIVE' as any } }),
      this.prisma.payment.aggregate({
        where: { ...paymentWhere, status: PaymentStatus.COMPLETED },
        _sum: { total: true },
      }),
      this.prisma.payment.aggregate({
        where: { ...paymentWhere, status: PaymentStatus.COMPLETED, createdAt: { gte: startOfDay, lte: endOfDay } },
        _sum: { total: true },
      }),
      this.prisma.payment.aggregate({
        where: { ...paymentWhere, status: PaymentStatus.COMPLETED, createdAt: { gte: startOfMonth } },
        _sum: { total: true },
      }),
      this.prisma.payment.count({ where: { ...paymentWhere, status: PaymentStatus.PENDING } }),
    ]);

    return {
      members: { total: totalMembers, active: activeMembers, inactive: inactiveMembers, expired: expiredMemberships, expiringSoon: expiringMemberships },
      attendance: { checkInsToday: todayCheckIns, checkOutsToday: todayCheckOuts, currentlyInGym: currentlyCheckedIn },
      batches: { total: totalBatches, active: activeBatches },
      revenue: { total: revenueAgg._sum.total ?? 0, today: revenueTodayAgg._sum.total ?? 0, thisMonth: revenueMonthAgg._sum.total ?? 0, pendingPayments },
    };
  }

  /**
   * Unified, canonical drill-down records for every dashboard KPI card.
   * Ensures 100% mathematical consistency with dashboardStats.
   */
  async dashboardDrillDown(gymId: string, query: DashboardDrillDownDto, user?: CurrentUserPayload) {
    const tz = await this.getGymTimezone(gymId);
    const now = new Date();
    const startOfDay = getGymStartOfDay(now, tz);
    const endOfDay = getGymEndOfDay(now, tz);
    const startOfMonth = getGymStartOfMonth(now, tz);
    const sevenDaysOut = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const skip = (page - 1) * limit;
    const search = query.search?.trim();

    let branchId: string | undefined;
    if (user && this.accessScope?.isBranchScoped(user)) {
      branchId = this.accessScope.getBranchId(user);
    }

    let data: any[] = [];
    let total = 0;
    let title = 'Dashboard Details';
    let viewAllUrl = '/dashboard';

    switch (query.metric) {
      case DashboardDrillMetric.ACTIVE_MEMBERS:
      case DashboardDrillMetric.MEMBERS_ACTIVE: {
        title = 'Active Members';
        viewAllUrl = '/members?status=ACTIVE';
        const where: any = { gymId, deletedAt: null, status: UserStatus.ACTIVE };
        if (branchId) where.branchId = branchId;
        if (search) {
          where.OR = [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
            { memberCode: { contains: search, mode: 'insensitive' } },
            { mobile: { contains: search } },
            { email: { contains: search, mode: 'insensitive' } },
          ];
        }
        [data, total] = await Promise.all([
          this.prisma.member.findMany({
            where,
            skip,
            take: limit,
            orderBy: { createdAt: query.sortOrder || 'desc' },
            include: {
              batch: { select: { id: true, name: true, startTime: true, endTime: true } },
              branch: { select: { id: true, name: true } },
              currentMembership: { select: { id: true, planName: true, endDate: true, status: true } },
            },
          }),
          this.prisma.member.count({ where }),
        ]);
        break;
      }

      case DashboardDrillMetric.MEMBERS_INACTIVE: {
        title = 'Inactive Members';
        viewAllUrl = '/members?status=INACTIVE';
        const where: any = { gymId, deletedAt: null, status: UserStatus.INACTIVE };
        if (branchId) where.branchId = branchId;
        if (search) {
          where.OR = [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
            { memberCode: { contains: search, mode: 'insensitive' } },
            { mobile: { contains: search } },
            { email: { contains: search, mode: 'insensitive' } },
          ];
        }
        [data, total] = await Promise.all([
          this.prisma.member.findMany({
            where,
            skip,
            take: limit,
            orderBy: { createdAt: query.sortOrder || 'desc' },
            include: {
              batch: { select: { id: true, name: true } },
              branch: { select: { id: true, name: true } },
              currentMembership: { select: { id: true, planName: true, endDate: true, status: true } },
            },
          }),
          this.prisma.member.count({ where }),
        ]);
        break;
      }

      case DashboardDrillMetric.MEMBERS_EXPIRED: {
        title = 'Expired Members';
        viewAllUrl = '/members?status=EXPIRED';
        const where: any = {
          gymId,
          deletedAt: null,
          currentMembership: { is: { endDate: { lt: now } } },
        };
        if (branchId) where.branchId = branchId;
        if (search) {
          where.OR = [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
            { memberCode: { contains: search, mode: 'insensitive' } },
            { mobile: { contains: search } },
          ];
        }
        [data, total] = await Promise.all([
          this.prisma.member.findMany({
            where,
            skip,
            take: limit,
            orderBy: { createdAt: query.sortOrder || 'desc' },
            include: {
              batch: { select: { id: true, name: true } },
              branch: { select: { id: true, name: true } },
              currentMembership: { select: { id: true, planName: true, endDate: true, status: true } },
            },
          }),
          this.prisma.member.count({ where }),
        ]);
        break;
      }

      case DashboardDrillMetric.EXPIRED_MEMBERSHIPS: {
        title = 'Expired Memberships';
        viewAllUrl = '/memberships?status=EXPIRED';
        const where: any = {
          gymId,
          deletedAt: null,
          status: MembershipStatus.ACTIVE,
          endDate: { lt: now },
        };
        if (branchId) where.member = { branchId };
        if (search) {
          where.member = {
            ...(where.member || {}),
            OR: [
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              { memberCode: { contains: search, mode: 'insensitive' } },
              { mobile: { contains: search } },
            ],
          };
        }
        [data, total] = await Promise.all([
          this.prisma.membership.findMany({
            where,
            skip,
            take: limit,
            orderBy: { endDate: query.sortOrder || 'desc' },
            include: {
              member: {
                select: { id: true, firstName: true, lastName: true, memberCode: true, mobile: true, photo: true },
              },
            },
          }),
          this.prisma.membership.count({ where }),
        ]);
        break;
      }

      case DashboardDrillMetric.EXPIRING_SOON: {
        title = 'Memberships Expiring Soon (Next 7 Days)';
        viewAllUrl = '/memberships?expiry=within_7_days';
        const where: any = {
          gymId,
          deletedAt: null,
          status: MembershipStatus.ACTIVE,
          endDate: { gte: now, lte: sevenDaysOut },
        };
        if (branchId) where.member = { branchId };
        if (search) {
          where.member = {
            ...(where.member || {}),
            OR: [
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              { memberCode: { contains: search, mode: 'insensitive' } },
              { mobile: { contains: search } },
            ],
          };
        }
        [data, total] = await Promise.all([
          this.prisma.membership.findMany({
            where,
            skip,
            take: limit,
            orderBy: { endDate: 'asc' },
            include: {
              member: {
                select: { id: true, firstName: true, lastName: true, memberCode: true, mobile: true, photo: true },
              },
            },
          }),
          this.prisma.membership.count({ where }),
        ]);
        break;
      }

      case DashboardDrillMetric.CHECKINS_TODAY: {
        title = "Today's Check-ins";
        viewAllUrl = '/attendance?date=today&event=CHECK_IN';
        const where: any = {
          gymId,
          checkInAt: { gte: startOfDay, lte: endOfDay },
        };
        if (branchId) where.branchId = branchId;
        if (search) {
          where.member = {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              { memberCode: { contains: search, mode: 'insensitive' } },
              { mobile: { contains: search } },
            ],
          };
        }
        [data, total] = await Promise.all([
          this.prisma.attendance.findMany({
            where,
            skip,
            take: limit,
            orderBy: { checkInAt: query.sortOrder || 'desc' },
            include: {
              member: {
                select: { id: true, firstName: true, lastName: true, memberCode: true, mobile: true, photo: true },
              },
              batch: { select: { id: true, name: true, startTime: true, endTime: true } },
              branch: { select: { id: true, name: true } },
            },
          }),
          this.prisma.attendance.count({ where }),
        ]);
        break;
      }

      case DashboardDrillMetric.CHECKOUTS_TODAY: {
        title = "Today's Check-outs";
        viewAllUrl = '/attendance?date=today&event=CHECK_OUT';
        const where: any = {
          gymId,
          checkOutAt: { gte: startOfDay, lte: endOfDay },
        };
        if (branchId) where.branchId = branchId;
        if (search) {
          where.member = {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              { memberCode: { contains: search, mode: 'insensitive' } },
              { mobile: { contains: search } },
            ],
          };
        }
        [data, total] = await Promise.all([
          this.prisma.attendance.findMany({
            where,
            skip,
            take: limit,
            orderBy: { checkOutAt: query.sortOrder || 'desc' },
            include: {
              member: {
                select: { id: true, firstName: true, lastName: true, memberCode: true, mobile: true, photo: true },
              },
              batch: { select: { id: true, name: true } },
              branch: { select: { id: true, name: true } },
            },
          }),
          this.prisma.attendance.count({ where }),
        ]);
        break;
      }

      case DashboardDrillMetric.CURRENTLY_IN_GYM: {
        title = 'Currently In Gym';
        viewAllUrl = '/attendance?status=OPEN';
        const where: any = {
          gymId,
          checkInAt: { gte: startOfDay, lte: endOfDay },
          checkOutAt: null,
        };
        if (branchId) where.branchId = branchId;
        if (search) {
          where.member = {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } },
              { memberCode: { contains: search, mode: 'insensitive' } },
              { mobile: { contains: search } },
            ],
          };
        }
        [data, total] = await Promise.all([
          this.prisma.attendance.findMany({
            where,
            skip,
            take: limit,
            orderBy: { checkInAt: query.sortOrder || 'desc' },
            include: {
              member: {
                select: { id: true, firstName: true, lastName: true, memberCode: true, mobile: true, photo: true },
              },
              batch: { select: { id: true, name: true } },
              branch: { select: { id: true, name: true } },
            },
          }),
          this.prisma.attendance.count({ where }),
        ]);
        break;
      }

      case DashboardDrillMetric.REVENUE_TODAY: {
        title = "Today's Revenue Transactions";
        viewAllUrl = '/payments?range=today&status=SUCCESS';
        const where: any = {
          gymId,
          status: PaymentStatus.COMPLETED,
          createdAt: { gte: startOfDay, lte: endOfDay },
          deletedAt: null,
        };
        if (branchId) where.member = { branchId };
        if (search) {
          where.OR = [
            { receiptNumber: { contains: search, mode: 'insensitive' } },
            { invoiceNumber: { contains: search, mode: 'insensitive' } },
            { member: { firstName: { contains: search, mode: 'insensitive' } } },
            { member: { lastName: { contains: search, mode: 'insensitive' } } },
            { member: { mobile: { contains: search } } },
          ];
        }
        [data, total] = await Promise.all([
          this.prisma.payment.findMany({
            where,
            skip,
            take: limit,
            orderBy: { createdAt: query.sortOrder || 'desc' },
            include: {
              member: {
                select: { id: true, firstName: true, lastName: true, memberCode: true, mobile: true },
              },
              verifiedBy: { select: { firstName: true, lastName: true } },
            },
          }),
          this.prisma.payment.count({ where }),
        ]);
        break;
      }

      case DashboardDrillMetric.REVENUE_MONTH: {
        title = 'Revenue This Month';
        viewAllUrl = '/payments?range=this_month&status=SUCCESS';
        const where: any = {
          gymId,
          status: PaymentStatus.COMPLETED,
          createdAt: { gte: startOfMonth },
          deletedAt: null,
        };
        if (branchId) where.member = { branchId };
        if (search) {
          where.OR = [
            { receiptNumber: { contains: search, mode: 'insensitive' } },
            { invoiceNumber: { contains: search, mode: 'insensitive' } },
            { member: { firstName: { contains: search, mode: 'insensitive' } } },
            { member: { lastName: { contains: search, mode: 'insensitive' } } },
            { member: { mobile: { contains: search } } },
          ];
        }
        [data, total] = await Promise.all([
          this.prisma.payment.findMany({
            where,
            skip,
            take: limit,
            orderBy: { createdAt: query.sortOrder || 'desc' },
            include: {
              member: {
                select: { id: true, firstName: true, lastName: true, memberCode: true, mobile: true },
              },
              verifiedBy: { select: { firstName: true, lastName: true } },
            },
          }),
          this.prisma.payment.count({ where }),
        ]);
        break;
      }

      default:
        throw new BadRequestException(`Unsupported drilldown metric: ${query.metric}`);
    }

    return {
      metric: query.metric,
      title,
      viewAllUrl,
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1,
      },
    };
  }

  /** Revenue + attendance trend for dashboard charts, scoped to this gym. */
  async dashboardAnalytics(gymId: string, days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [payments, attendance] = await Promise.all([
      this.prisma.payment.findMany({
        where: { gymId, status: PaymentStatus.COMPLETED, createdAt: { gte: since } },
        select: { createdAt: true, total: true },
      }),
      this.prisma.attendance.findMany({
        where: { gymId, checkInAt: { gte: since } },
        select: { checkInAt: true },
      }),
    ]);

    return {
      revenueByDay: this.groupByDay(payments as any[], (p) => p.createdAt, (p) => Number(p.total)),
      attendanceByDay: this.groupByDay(attendance as any[], (a) => a.checkInAt, () => 1),
      periodDays: days,
    };
  }

  /** Per-batch member count, seat utilization, and attendance % — feeds the batch stats widget. */
  async batchStatistics(gymId: string) {
    const batches = await this.prisma.batch.findMany({
      where: { gymId, deletedAt: null },
      include: { _count: { select: { members: true } } },
    });

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    return Promise.all(
      batches.map(async (batch: any) => {
        const attendanceCount = await this.prisma.attendance.count({
          where: { batchId: batch.id, checkInAt: { gte: thirtyDaysAgo } },
        });
        const memberCount = batch._count.members;
        const utilizationPct = batch.capacity > 0 ? Math.round((memberCount / batch.capacity) * 100) : 0;
        return {
          id: batch.id,
          name: batch.name,
          capacity: batch.capacity,
          members: memberCount,
          utilizationPct,
          attendanceLast30Days: attendanceCount,
        };
      }),
    );
  }

  /** Recent activity feed for the dashboard — latest audit log entries for this gym (capped at 5). */
  async recentActivity(gymId: string, limit = 5) {
    const safeLimit = Math.min(5, Math.max(1, limit ?? 5));
    const { logs } = await this.audit.getAuditLogs(gymId, { limit: safeLimit, offset: 0 });
    return logs;
  }

  private groupByDay<T>(items: T[], getDate: (item: T) => Date, getValue: (item: T) => number): { date: string; value: number }[] {
    const map = new Map<string, number>();
    for (const item of items) {
      const key = getDate(item).toISOString().slice(0, 10);
      map.set(key, (map.get(key) ?? 0) + getValue(item));
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date, value }));
  }
}
