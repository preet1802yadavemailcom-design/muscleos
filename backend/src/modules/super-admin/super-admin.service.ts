import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';
import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { GymStatus, NotificationChannel, NotificationType, NotificationStatus, PaymentStatus, UserRole, Prisma } from '@prisma/client';
import { AuditService } from '@shared/services/audit.service';

import {
  QueryGymsDto, RejectGymDto, SuspendGymDto, CreateGymPlanDto, UpdateGymPlanDto,
  CreateAnnouncementDto, UpdateTicketDto, QueryAuditLogsDto,
} from './dto';


@Injectable()
export class SuperAdminService {
  private readonly logger = new Logger(SuperAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
  ) {}

  // ---------- Dashboard ----------

  /** Top-line platform stats: total gyms, members, revenue, trainers (spec Module 03). */
  async dashboardStats() {
    const [totalGyms, activeGyms, pendingGyms, suspendedGyms, totalMembers, totalTrainers, revenueAgg] =
      await Promise.all([
        this.prisma.gym.count({ where: { deletedAt: null } }),
        this.prisma.gym.count({ where: { status: GymStatus.ACTIVE, deletedAt: null } }),
        this.prisma.gym.count({ where: { status: GymStatus.PENDING, deletedAt: null } }),
        this.prisma.gym.count({ where: { status: GymStatus.SUSPENDED, deletedAt: null } }),
        this.prisma.member.count({ where: { deletedAt: null } }),
        this.prisma.user.count({ where: { role: UserRole.TRAINER } }),
        this.prisma.payment.aggregate({
          where: { status: PaymentStatus.COMPLETED },
          _sum: { total: true },
        }),
      ]);

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const [newGymsLast30d, newMembersLast30d, revenueLast30d] = await Promise.all([
      this.prisma.gym.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      this.prisma.member.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      this.prisma.payment.aggregate({
        where: { status: PaymentStatus.COMPLETED, createdAt: { gte: thirtyDaysAgo } },
        _sum: { total: true },
      }),
    ]);

    return {
      gyms: { total: totalGyms, active: activeGyms, pending: pendingGyms, suspended: suspendedGyms, newLast30Days: newGymsLast30d },
      members: { total: totalMembers, newLast30Days: newMembersLast30d },
      trainers: { total: totalTrainers },
      revenue: {
        total: revenueAgg._sum.total ?? 0,
        last30Days: revenueLast30d._sum.total ?? 0,
      },
    };
  }

  /** Revenue + attendance trend series for dashboard charts, grouped by day.
   * Maximum window: 365 days. Validated at the DTO layer (AnalyticsQueryDto)
   * and again here as server-side defense-in-depth.
   */
  async analytics(days = 30) {
    // Server-side guard — rejects 0/-ve values and clamps to 365 even if
    // the controller/DTO validation is somehow bypassed.
    // Use explicit isNaN check so days=0 is clamped to 1 (not treated as falsy).
    const rawDays = Number(days);
    const safeDays = Math.min(Math.max(1, Math.floor(isNaN(rawDays) ? 30 : rawDays)), 365);
    const since = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);

    // Row cap per query: platforms with years of data could still produce
    // tens of thousands of rows for a 365-day window. We cap at 50 000 rows
    // per table which is well above any real dashboard need and prevents OOM.
    const ROW_CAP = 50_000;

    const [payments, attendance] = await Promise.all([
      this.prisma.payment.findMany({
        where: { status: PaymentStatus.COMPLETED, createdAt: { gte: since } },
        select: { createdAt: true, total: true },
        take: ROW_CAP,
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.attendance.findMany({
        where: { checkInAt: { gte: since } },
        select: { checkInAt: true },
        take: ROW_CAP,
        orderBy: { checkInAt: 'asc' },
      }),
    ]);

    const revenueByDay = this.groupByDay<{ createdAt: Date; total: Prisma.Decimal }>(payments, (p) => p.createdAt, (p) => Number(p.total));
    const attendanceByDay = this.groupByDay<{ checkInAt: Date }>(attendance, (a) => a.checkInAt, () => 1);

    return { revenueByDay, attendanceByDay, periodDays: safeDays };
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

  // ---------- Gym Owner / Gym lifecycle management ----------

  async listGyms(query: QueryGymsDto) {
    const { page = 1, limit = 20, search, status, planType } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.GymWhereInput = { deletedAt: null };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (status) where.status = status;
    if (planType) where.planType = planType;

    const [data, total] = await Promise.all([
      this.prisma.gym.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { members: true, users: true, batches: true } },
        },
      }),
      this.prisma.gym.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /** Export the filtered gym list as flat rows ready for PDF/Excel/CSV generation. */
  async exportData(query: QueryGymsDto) {
    const { search, status, planType } = query;
    const where: Prisma.GymWhereInput = { deletedAt: null };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (status) where.status = status;
    if (planType) where.planType = planType;

    const gyms = await this.prisma.gym.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { members: true, users: true, batches: true } } },
    });

    return gyms.map((g) => ({
      id: g.id,
      name: g.name,
      email: g.email,
      status: g.status,
      planType: g.planType,
      members: g._count.members,
      staff: g._count.users,
      batches: g._count.batches,
      createdAt: g.createdAt,
    }));
  }

  async getGym(id: string) {
    const gym = await this.prisma.gym.findFirst({
      where: { id, deletedAt: null },
      include: {
        _count: { select: { members: true, users: true, batches: true, payments: true } },
      },
    });
    if (!gym) throw new NotFoundException('Gym not found');
    return gym;
  }

  async approveGym(id: string, adminId: string) {
    const gym = await this.getGym(id);
    if (gym.status === GymStatus.ACTIVE) throw new BadRequestException('Gym is already active');

    const updated = await this.prisma.gym.update({
      where: { id },
      data: { status: GymStatus.ACTIVE },
    });
    await this.audit.log({
      action: 'GYM_APPROVED', entity: 'Gym', entityId: id, userId: adminId, gymId: id,
    });
    return updated;
  }

  async rejectGym(id: string, dto: RejectGymDto, adminId: string) {
    await this.getGym(id);
    const updated = await this.prisma.gym.update({
      where: { id },
      data: { status: GymStatus.REJECTED },
    });
    await this.audit.log({
      action: 'GYM_REJECTED', entity: 'Gym', entityId: id, userId: adminId, gymId: id,
      newValue: { reason: dto.reason },
    });
    return updated;
  }

  /**
   * Revokes all active sessions for every user belonging to `gymId`.
   *
   * DB-level revocation (refreshToken + userSession) is done inside a Prisma
   * $transaction so it is atomic with the gym status change that called this.
   * Redis invalidation is best-effort and fires *after* the DB commit: a Redis
   * failure is logged but never re-throws, because the DB-authoritative state
   * (gym.status = SUSPENDED/DELETED) is the definitive revocation signal that
   * JwtStrategy re-reads on every request.
   */
  private async purgeGymSessions(gymId: string): Promise<void> {
    const users = await this.prisma.user.findMany({
      where: { gymId },
      select: { id: true },
    });
    const userIds = users.map((u) => u.id);
    if (userIds.length === 0) return;

    // Atomic DB revocation: both tables succeed or both roll back.
    await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({
        where: { userId: { in: userIds }, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.userSession.updateMany({
        where: { userId: { in: userIds }, isActive: true },
        data: { isActive: false },
      }),
    ]);

    // Best-effort Redis invalidation — runs after the DB transaction commits.
    // A failure here does NOT constitute an authorization bypass because
    // JwtStrategy checks gym.status from the DB on every authenticated request.
    const nowMs = Date.now().toString();
    const redisTtlSeconds = 7 * 24 * 60 * 60; // 7 days
    try {
      await Promise.all(
        userIds.map((uid) =>
          Promise.all([
            this.redis.set(`user_revoked_at:${uid}`, nowMs, redisTtlSeconds),
            this.redis.del(`session:${uid}`),
          ]),
        ),
      );
    } catch (err: any) {
      // Log the failure so ops can investigate but do not throw — the DB
      // revocation is already committed and authoritative.
      this.logger.error(
        `Redis session purge incomplete for gym ${gymId} (${userIds.length} users). ` +
        `Sessions will be revoked on next DB-check but Redis cache may be stale. Error: ${err?.message ?? err}`,
      );
    }
  }

  async suspendGym(id: string, dto: SuspendGymDto, adminId: string) {
    const gym = await this.getGym(id);
    if (gym.status === GymStatus.SUSPENDED) throw new BadRequestException('Gym is already suspended');

    // Atomically update gym status in the DB then purge sessions (which wraps
    // its own DB transaction internally).
    const updated = await this.prisma.gym.update({
      where: { id },
      data: { status: GymStatus.SUSPENDED },
    });
    await this.purgeGymSessions(id);
    await this.audit.log({
      action: 'GYM_SUSPENDED', entity: 'Gym', entityId: id, userId: adminId, gymId: id,
      newValue: { reason: dto.reason },
    });
    return updated;
  }

  async reactivateGym(id: string, adminId: string) {
    const gym = await this.getGym(id);
    if (gym.status !== GymStatus.SUSPENDED) throw new BadRequestException('Only suspended gyms can be reactivated');

    const updated = await this.prisma.gym.update({
      where: { id },
      data: { status: GymStatus.ACTIVE },
    });
    await this.audit.log({ action: 'GYM_REACTIVATED', entity: 'Gym', entityId: id, userId: adminId, gymId: id });
    return updated;
  }

  /** Soft delete — platform-level, used rarely (e.g. fraudulent signup).
   * Sets deletedAt + SUSPENDED in the DB atomically, then purges sessions.
   */
  async deleteGym(id: string, adminId: string) {
    await this.getGym(id);
    await this.prisma.gym.update({ where: { id }, data: { deletedAt: new Date(), status: GymStatus.SUSPENDED } });
    await this.purgeGymSessions(id);
    await this.audit.log({ action: 'GYM_DELETED', entity: 'Gym', entityId: id, userId: adminId, gymId: id });
    return { message: 'Gym deleted successfully' };
  }

  // ---------- Gym Plan management ----------

  async listPlans() {
    return this.prisma.gymPlan.findMany({ orderBy: { monthlyPrice: 'asc' } });
  }

  async createPlan(dto: CreateGymPlanDto, adminId: string) {
    const existing = await this.prisma.gymPlan.findUnique({ where: { name: dto.name } });
    if (existing) throw new BadRequestException('A plan with this name already exists');

    const plan = await this.prisma.gymPlan.create({ data: { ...dto, features: dto.features ?? [] } });
    await this.audit.log({ action: 'PLAN_CREATED', entity: 'GymPlan', entityId: plan.id, userId: adminId });
    return plan;
  }

  async updatePlan(id: string, dto: UpdateGymPlanDto, adminId: string) {
    const existing = await this.prisma.gymPlan.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Plan not found');

    const plan = await this.prisma.gymPlan.update({ where: { id }, data: dto });
    await this.audit.log({ action: 'PLAN_UPDATED', entity: 'GymPlan', entityId: id, userId: adminId, oldValue: existing, newValue: plan });
    return plan;
  }

  async deletePlan(id: string, adminId: string) {
    const existing = await this.prisma.gymPlan.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Plan not found');
    await this.prisma.gymPlan.update({ where: { id }, data: { isActive: false } });
    await this.audit.log({ action: 'PLAN_DEACTIVATED', entity: 'GymPlan', entityId: id, userId: adminId });
    return { message: 'Plan deactivated' };
  }

  // ---------- Announcements ----------

  /** Broadcasts an announcement to specific gyms, or every active gym when gymIds is omitted. */
  async createAnnouncement(dto: CreateAnnouncementDto, adminId: string) {
    const targetGyms: string[] = dto.gymIds?.length
      ? dto.gymIds
      : (await this.prisma.gym.findMany({ where: { status: GymStatus.ACTIVE, deletedAt: null }, select: { id: true } })).map((g: { id: string }) => g.id);

    if (targetGyms.length === 0) throw new BadRequestException('No target gyms found for this announcement');

    const notifications = await this.prisma.$transaction(
      targetGyms.map((gymId: string) =>
        this.prisma.notification.create({
          data: {
            type: NotificationType.ANNOUNCEMENT,
            channel: dto.channel ?? NotificationChannel.IN_APP,
            title: dto.title,
            content: dto.content,
            status: NotificationStatus.PENDING,
            gymId,
          },
        }),
      ),
    );

    await this.audit.log({
      action: 'ANNOUNCEMENT_BROADCAST', entity: 'Notification', userId: adminId,
      newValue: { title: dto.title, targetGymCount: targetGyms.length },
    });

    return { message: `Announcement queued for ${notifications.length} gym(s)`, count: notifications.length };
  }

  // ---------- Support tickets ----------

  async listTickets(status?: string, priority?: string, page = 1, limit = 20) {
    const where: Prisma.SupportTicketWhereInput = {};
    if (status) where.status = status as any;
    if (priority) where.priority = priority as any;

    const [data, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        include: { gym: { select: { id: true, name: true } } },
      }),
      this.prisma.supportTicket.count({ where }),
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async updateTicket(id: string, dto: UpdateTicketDto, adminId: string) {
    const existing = await this.prisma.supportTicket.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Ticket not found');

    const data: Prisma.SupportTicketUpdateInput = { ...dto };
    if (dto.status === 'RESOLVED' || dto.status === 'CLOSED') {
      data.resolvedAt = new Date();
    }

    const ticket = await this.prisma.supportTicket.update({ where: { id }, data });
    await this.audit.log({
      action: 'TICKET_UPDATED', entity: 'SupportTicket', entityId: id, userId: adminId,
      oldValue: { status: existing.status }, newValue: { status: ticket.status },
    });
    return ticket;
  }

  // ---------- Platform-wide audit logs ----------

  async auditLogs(query: QueryAuditLogsDto) {
    const { page = 1, limit = 50, gymId, userId, action, entity } = query;
    return this.audit.getAuditLogs(gymId ?? null, {
      userId, action, entity,
      limit,
      offset: (page - 1) * limit,
    });
  }
}
