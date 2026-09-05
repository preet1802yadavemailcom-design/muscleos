import { PrismaService } from '@database/prisma.service';
import { AuthService } from '@modules/auth/auth.service';
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { GymStatus, PlanType, UserRole, UserStatus, MembershipStatus, PaymentStatus, Prisma } from '@prisma/client';
import { AuditService } from '@shared/services/audit.service';
import * as bcrypt from 'bcryptjs';

import { RegisterGymDto, UpdateGymProfileDto } from './dto';


@Injectable()
export class GymsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly authService: AuthService,
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

  async dashboardStats(gymId: string) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const sevenDaysOut = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const [
      totalMembers, activeMembers, inactiveMembers, expiredMemberships, expiringMemberships,
      todayCheckIns, todayCheckOuts, currentlyCheckedIn, totalBatches, activeBatches,
      revenueAgg, revenueTodayAgg, revenueMonthAgg, pendingPayments,
    ] = await Promise.all([
      this.prisma.member.count({ where: { gymId, deletedAt: null } }),
      this.prisma.member.count({ where: { gymId, deletedAt: null, status: UserStatus.ACTIVE } }),
      this.prisma.member.count({ where: { gymId, deletedAt: null, status: UserStatus.INACTIVE } }),
      this.prisma.membership.count({ where: { gymId, status: MembershipStatus.ACTIVE, endDate: { lt: new Date() } } }),
      this.prisma.membership.count({ where: { gymId, status: MembershipStatus.ACTIVE, endDate: { gte: new Date(), lte: sevenDaysOut } } }),
      this.prisma.attendance.count({ where: { gymId, checkInAt: { gte: startOfDay } } }),
      this.prisma.attendance.count({ where: { gymId, checkOutAt: { gte: startOfDay } } }),
      // Scoped to today's check-ins specifically — an attendance row left
      // open from days ago (missed checkout) shouldn't inflate "currently
      // inside" forever. Stale sessions like that are force-closed by the
      // nightly cleanup job (see notifications.service.ts#forceCloseStaleAttendanceSessions);
      // this scoping is a second, independent safeguard against the same
      // failure mode showing up as a wrong live metric.
      this.prisma.attendance.count({ where: { gymId, checkInAt: { gte: startOfDay }, checkOutAt: null } }),
      this.prisma.batch.count({ where: { gymId, deletedAt: null } }),
      this.prisma.batch.count({ where: { gymId, deletedAt: null, status: 'ACTIVE' as any } }),
      this.prisma.payment.aggregate({ where: { gymId, status: PaymentStatus.COMPLETED }, _sum: { total: true } }),
      this.prisma.payment.aggregate({ where: { gymId, status: PaymentStatus.COMPLETED, createdAt: { gte: startOfDay } }, _sum: { total: true } }),
      this.prisma.payment.aggregate({ where: { gymId, status: PaymentStatus.COMPLETED, createdAt: { gte: startOfMonth } }, _sum: { total: true } }),
      this.prisma.payment.count({ where: { gymId, status: PaymentStatus.PENDING } }),
    ]);

    return {
      members: { total: totalMembers, active: activeMembers, inactive: inactiveMembers, expired: expiredMemberships, expiringSoon: expiringMemberships },
      attendance: { checkInsToday: todayCheckIns, checkOutsToday: todayCheckOuts, currentlyInGym: currentlyCheckedIn },
      batches: { total: totalBatches, active: activeBatches },
      revenue: { total: revenueAgg._sum.total ?? 0, today: revenueTodayAgg._sum.total ?? 0, thisMonth: revenueMonthAgg._sum.total ?? 0, pendingPayments },
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

  /** Recent activity feed for the dashboard — latest audit log entries for this gym. */
  async recentActivity(gymId: string, limit = 20) {
    const { logs } = await this.audit.getAuditLogs(gymId, { limit, offset: 0 });
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
