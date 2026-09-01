import { PrismaService } from '@database/prisma.service';
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { NotificationType, NotificationChannel } from '@prisma/client';
import { AuditService } from '@shared/services/audit.service';

import {
  CreateMembershipDto,
  RenewMembershipDto,
  FreezeMembershipDto,
  TransferMembershipDto,
  ChangePlanDto,
  QueryMembershipDto,
} from './dto';

const PLAN_DURATION_DAYS: Record<string, number> = {
  TRIAL: 7,
  MONTHLY: 30,
  QUARTERLY: 90,
  HALF_YEARLY: 180,
  YEARLY: 365,
};

const RENEWAL_REMINDER_WINDOW_DAYS = 7;

function resolveDuration(plan: string, durationDays?: number): number {
  if (plan === 'CUSTOM') {
    if (!durationDays) throw new BadRequestException('durationDays is required for CUSTOM plan');
    return durationDays;
  }
  const d = PLAN_DURATION_DAYS[plan];
  if (!d) throw new BadRequestException('Invalid plan');
  return durationDays ?? d;
}

function withComputed(m: any) {
  if (!m) return m;
  const now = new Date();
  const remainingDays =
    m.endDate && m.status === 'ACTIVE'
      ? Math.max(Math.ceil((new Date(m.endDate).getTime() - now.getTime()) / 86400000), 0)
      : 0;
  return { ...m, remainingDays };
}

import { NotificationsService } from '@modules/notifications/notifications.service';

@Injectable()
export class MembershipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async findAll(gymId: string, query: QueryMembershipDto) {
    const { page = 1, limit = 20, status, plan, memberId, expiringInDays, search } = query;
    const skip = (page - 1) * limit;
    const where: any = { gymId, deletedAt: null };
    if (status) where.status = status;
    if (plan) where.plan = plan;
    if (memberId) where.memberId = memberId;
    if (search) {
      where.member = {
        OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { memberCode: { contains: search, mode: 'insensitive' } },
          { mobile: { contains: search, mode: 'insensitive' } },
        ],
      };
    }
    if (expiringInDays !== undefined) {
      const to = new Date();
      to.setDate(to.getDate() + expiringInDays);
      where.endDate = { gte: new Date(), lte: to };
      where.status = 'ACTIVE';
    }

    const [data, total] = await Promise.all([
      this.prisma.membership.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { member: { select: { id: true, firstName: true, lastName: true, memberCode: true, photo: true } } },
      }),
      this.prisma.membership.count({ where }),
    ]);

    return {
      data: data.map(withComputed),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit), hasNextPage: page * limit < total, hasPrevPage: page > 1 },
    };
  }

  /** Canonical member-identity resolution: authenticated userId → Member.userId
   *  → memberId. NOT email/mobile matching — this is what lets the same
   *  person's multiple phones/devices, all logged into the same account,
   *  resolve to the exact same member and see the exact same membership
   *  history, and it's what stops one member ever reaching another
   *  member's data through this endpoint. */
  async findMine(gymId: string, userId: string) {
    const member = await this.prisma.member.findFirst({
      where: { userId, gymId, deletedAt: null },
    });
    if (!member) {
      throw new NotFoundException('No member profile is linked to this account yet — ask staff to link your profile.');
    }
    const memberships = await this.prisma.membership.findMany({
      where: { memberId: member.id, gymId },
      orderBy: { startDate: 'desc' },
      include: { branch: { select: { id: true, name: true } } },
    });
    return memberships.map(withComputed);
  }

  async findOne(id: string, gymId: string) {
    const item = await this.prisma.membership.findFirst({
      where: { id, gymId, deletedAt: null },
      include: { member: true, payments: true },
    });
    if (!item) throw new NotFoundException('Membership not found');
    return withComputed(item);
  }

  async create(gymId: string, dto: CreateMembershipDto) {
    const member = await this.prisma.member.findFirst({ where: { id: dto.memberId, gymId, deletedAt: null } });
    if (!member) throw new NotFoundException('Member not found');

    const durationDays = resolveDuration(dto.plan, dto.durationDays);
    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + durationDays);

    const discountAmount = dto.discountAmount ?? 0;
    const taxAmount = dto.taxAmount ?? 0;
    const totalAmount = Math.max(dto.baseAmount - discountAmount, 0) + taxAmount;

    const membership = await this.prisma.$transaction(async (tx) => {
      const created = await tx.membership.create({
        data: {
          memberId: member.id,
          plan: dto.plan,
          planName: dto.plan,
          duration: durationDays,
          startDate,
          endDate,
          baseAmount: dto.baseAmount,
          discountAmount,
          taxAmount,
          totalAmount,
          isAutoRenew: dto.isAutoRenew ?? false,
          gymId,
        },
      });
      await tx.member.update({ where: { id: member.id }, data: { currentMembershipId: created.id, status: 'ACTIVE' } });
      return created;
    });

    await this.audit.log({ action: 'CREATE', entity: 'Membership', entityId: membership.id, newValue: membership, gymId });

    // Best-effort — a failed notification send must never fail the actual
    // membership creation (member.email may also be missing for phone-less
    // members, which NotificationsService already handles gracefully).
    this.notifications.send(gymId, {
      type: NotificationType.SYSTEM,
      channel: NotificationChannel.EMAIL,
      memberId: member.id,
      templateName: 'membership_created',
      variables: { memberName: member.firstName, planName: membership.planName, endDate: membership.endDate.toLocaleDateString() },
    }).catch(() => undefined);

    return withComputed(membership);
  }

  /**
   * Renew: creates a new membership row chained to the previous one.
   * Start date = later of (today, previous endDate) so unused paid days are never lost.
   * Member's currentMembershipId is repointed to the new record.
   */
  async renew(id: string, gymId: string, dto: RenewMembershipDto) {
    const existing = await this.prisma.membership.findFirst({ where: { id, gymId, deletedAt: null } });
    if (!existing) throw new NotFoundException('Membership not found');

    // When the client renews without specifying plan/pricing (e.g. one-click renew), carry over the current terms.
    const plan = dto.plan ?? existing.plan;
    const baseAmount = dto.baseAmount !== undefined ? dto.baseAmount : Number(existing.baseAmount);

    const durationDays = resolveDuration(
      plan,
      dto.durationDays ?? (plan === existing.plan ? existing.duration : undefined),
    );
    const now = new Date();
    const startDate = existing.endDate > now ? existing.endDate : now;
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + durationDays);

    const discountAmount = dto.discountAmount ?? 0;
    const taxAmount = dto.taxAmount ?? 0;
    const totalAmount = Math.max(baseAmount - discountAmount, 0) + taxAmount;

    const renewed = await this.prisma.$transaction(async (tx) => {
      const created = await tx.membership.create({
        data: {
          memberId: existing.memberId,
          plan,
          planName: plan,
          duration: durationDays,
          startDate,
          endDate,
          baseAmount,
          discountAmount,
          taxAmount,
          totalAmount,
          isAutoRenew: dto.isAutoRenew ?? existing.isAutoRenew,
          previousMembershipId: existing.id,
          gymId,
        },
      });
      await tx.member.update({
        where: { id: existing.memberId },
        data: { currentMembershipId: created.id, status: 'ACTIVE' },
      });
      // mark previous as expired if it had already lapsed; otherwise leave as historical ACTIVE record until its own endDate
      if (existing.endDate <= now && existing.status === 'ACTIVE') {
        await tx.membership.update({ where: { id: existing.id }, data: { status: 'EXPIRED' } });
      }
      return created;
    });

    await this.audit.log({
      action: 'RENEW',
      entity: 'Membership',
      entityId: renewed.id,
      oldValue: existing,
      newValue: renewed,
      gymId,
    });

    const member = await this.prisma.member.findUnique({ where: { id: renewed.memberId } });
    if (member) {
      this.notifications.send(gymId, {
        type: NotificationType.SYSTEM,
        channel: NotificationChannel.EMAIL,
        memberId: member.id,
        templateName: 'membership_renewed',
        variables: { memberName: member.firstName, planName: renewed.planName, endDate: renewed.endDate.toLocaleDateString() },
      }).catch(() => undefined);
    }

    return withComputed(renewed);
  }

  /** Freeze: pauses membership and pushes endDate out by the frozen day count so no paid days are lost. */
  async freeze(id: string, gymId: string, dto: FreezeMembershipDto) {
    const existing = await this.findOne(id, gymId);
    if (existing.status !== 'ACTIVE') {
      throw new BadRequestException(`Cannot freeze a membership with status ${existing.status}`);
    }
    const freezeStart = new Date(dto.freezeStart);
    const freezeEnd = new Date(dto.freezeEnd);
    if (freezeStart >= freezeEnd) {
      throw new BadRequestException('freezeStart must be before freezeEnd');
    }
    const freezeDays = Math.ceil((freezeEnd.getTime() - freezeStart.getTime()) / 86400000);
    const newEndDate = new Date(existing.endDate);
    newEndDate.setDate(newEndDate.getDate() + freezeDays);

    const item = await this.prisma.membership.update({
      where: { id },
      data: {
        status: 'FROZEN',
        freezeStart,
        freezeEnd,
        freezeReason: dto.freezeReason,
        endDate: newEndDate,
      },
    });
    await this.audit.log({ action: 'FREEZE', entity: 'Membership', entityId: id, oldValue: existing, newValue: item, gymId });
    return withComputed(item);
  }

  async unfreeze(id: string, gymId: string) {
    const existing = await this.findOne(id, gymId);
    if (existing.status !== 'FROZEN') {
      throw new BadRequestException('Membership is not currently frozen');
    }
    const item = await this.prisma.membership.update({
      where: { id },
      data: { status: existing.endDate < new Date() ? 'EXPIRED' : 'ACTIVE' },
    });
    await this.audit.log({ action: 'UNFREEZE', entity: 'Membership', entityId: id, oldValue: existing, newValue: item, gymId });
    return withComputed(item);
  }

  /**
   * Transfer: moves the remaining validity of a membership to another member.
   * Creates a fresh membership row for the target member and closes out the source.
   */
  async transfer(id: string, gymId: string, dto: TransferMembershipDto) {
    const existing = await this.prisma.membership.findFirst({
      where: { id, gymId, deletedAt: null },
      include: { member: true },
    });
    if (!existing) throw new NotFoundException('Membership not found');
    if (existing.status !== 'ACTIVE') {
      throw new BadRequestException(`Cannot transfer a membership with status ${existing.status}`);
    }
    if (dto.toMemberId === existing.memberId) {
      throw new BadRequestException('Cannot transfer a membership to the same member');
    }
    const target = await this.prisma.member.findFirst({ where: { id: dto.toMemberId, gymId, deletedAt: null } });
    if (!target) throw new NotFoundException('Target member not found');

    const transferred = await this.prisma.$transaction(async (tx) => {
      const created = await tx.membership.create({
        data: {
          memberId: target.id,
          plan: existing.plan,
          planName: existing.planName,
          duration: existing.duration,
          startDate: new Date(),
          endDate: existing.endDate,
          baseAmount: existing.baseAmount,
          discountAmount: existing.discountAmount,
          taxAmount: existing.taxAmount,
          totalAmount: existing.totalAmount,
          transferredFrom: existing.memberId,
          gymId,
        },
      });
      await tx.membership.update({
        where: { id: existing.id },
        data: { status: 'CANCELLED', transferredTo: target.id, transferDate: new Date() },
      });
      await tx.member.update({ where: { id: target.id }, data: { currentMembershipId: created.id, status: 'ACTIVE' } });
      if (existing.member.currentMembershipId === existing.id) {
        await tx.member.update({ where: { id: existing.memberId }, data: { currentMembershipId: null } });
      }
      return created;
    });

    await this.audit.log({
      action: 'TRANSFER',
      entity: 'Membership',
      entityId: existing.id,
      oldValue: existing,
      newValue: transferred,
      gymId,
    });
    return withComputed(transferred);
  }

  /** Upgrade/downgrade: changes plan and pricing on the current membership in place. */
  async changePlan(id: string, gymId: string, dto: ChangePlanDto) {
    const existing = await this.findOne(id, gymId);
    if (existing.status !== 'ACTIVE') {
      throw new BadRequestException(`Cannot change plan on a membership with status ${existing.status}`);
    }
    if (dto.plan === existing.plan) {
      throw new ConflictException('Membership is already on this plan');
    }
    const totalAmount = Math.max(dto.baseAmount - Number(existing.discountAmount), 0) + Number(existing.taxAmount);

    const item = await this.prisma.membership.update({
      where: { id },
      data: { plan: dto.plan, planName: dto.plan, baseAmount: dto.baseAmount, totalAmount },
    });
    await this.audit.log({ action: 'CHANGE_PLAN', entity: 'Membership', entityId: id, oldValue: existing, newValue: item, gymId });
    return withComputed(item);
  }

  /** Cron entry point: expire lapsed memberships, flag those nearing expiry for renewal reminders. */
  async runExpiryCheck(gymId?: string) {
    const now = new Date();
    const where: any = { status: 'ACTIVE', endDate: { lt: now }, deletedAt: null };
    if (gymId) where.gymId = gymId;
    const expired = await this.prisma.membership.updateMany({ where, data: { status: 'EXPIRED' } });

    const reminderCutoff = new Date();
    reminderCutoff.setDate(reminderCutoff.getDate() + RENEWAL_REMINDER_WINDOW_DAYS);
    const expiringWhere: any = {
      status: 'ACTIVE',
      endDate: { gte: now, lte: reminderCutoff },
      renewalReminderSent: false,
      deletedAt: null,
    };
    if (gymId) expiringWhere.gymId = gymId;
    const expiringSoon = await this.prisma.membership.findMany({
      where: expiringWhere,
      include: { member: { select: { id: true, firstName: true, lastName: true, mobile: true, email: true } } },
    });
    // Actually send the reminder now (previously this only flagged
    // renewalReminderSent without ever dispatching anything — the comment
    // said "wired up in Module 12" but that wiring was never done).
    if (expiringSoon.length) {
      await this.prisma.membership.updateMany({
        where: { id: { in: expiringSoon.map((m) => m.id) } },
        data: { renewalReminderSent: true },
      });
      for (const m of expiringSoon) {
        if (!m.member) continue;
        const daysLeft = Math.ceil((m.endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        const content = `Hi ${m.member.firstName}, your membership expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'} (${m.endDate.toLocaleDateString()}). Renew now to keep your access.`;
        this.notifications.send(m.gymId, {
          type: 'MEMBERSHIP_EXPIRY' as any,
          channel: 'WHATSAPP' as any,
          memberId: m.member.id,
          content,
          title: 'Membership expiring soon',
        } as any).catch(() => undefined);
        if (m.member.email) {
          this.notifications.send(m.gymId, {
            type: 'MEMBERSHIP_EXPIRY' as any,
            channel: NotificationChannel.EMAIL,
            memberId: m.member.id,
            content,
            title: 'Membership expiring soon',
          } as any).catch(() => undefined);
        }
      }
    }
    return { expiredCount: expired.count, remindersDue: expiringSoon };
  }

  async exportData(gymId: string, query: QueryMembershipDto) {
    const { data } = await this.findAll(gymId, { ...query, page: 1, limit: 10000 });
    return data.map((m: any) => ({
      Member: `${m.member.firstName} ${m.member.lastName}`,
      MemberCode: m.member.memberCode,
      Plan: m.plan,
      StartDate: m.startDate,
      EndDate: m.endDate,
      RemainingDays: m.remainingDays,
      Status: m.status,
      TotalAmount: m.totalAmount,
      AutoRenew: m.isAutoRenew ? 'Yes' : 'No',
    }));
  }

  async remove(id: string, gymId: string) {
    const existing = await this.findOne(id, gymId);
    await this.prisma.membership.update({ where: { id }, data: { status: 'CANCELLED', deletedAt: new Date() } });
    await this.audit.log({ action: 'DELETE', entity: 'Membership', entityId: id, oldValue: existing, gymId });
    return { message: 'Membership cancelled successfully' };
  }
}
