import { PrismaService } from '@database/prisma.service';
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationChannel, NotificationStatus, NotificationType } from '@prisma/client';
import { AuditService } from '@shared/services/audit.service';
import { LoggerService } from '@shared/services/logger.service';

import { SendNotificationDto, CreateAnnouncementDto, UpsertTemplateDto } from './dto/send-notification.dto';
import { EmailProvider } from './providers/email.provider';
import { PushProvider } from './providers/push.provider';
import { SmsProvider } from './providers/sms.provider';
import { WhatsappProvider } from './providers/whatsapp.provider';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly logger: LoggerService,
    private readonly email: EmailProvider,
    private readonly sms: SmsProvider,
    private readonly push: PushProvider,
    private readonly whatsapp: WhatsappProvider,
  ) {}

  // ---------- Listing / logs ----------

  async findAll(
    gymId: string,
    options: { page: number; limit: number; status?: NotificationStatus; type?: NotificationType },
  ) {
    const { page, limit, status, type } = options;
    const skip = (page - 1) * limit;
    const where: any = { gymId };
    if (status) where.status = status;
    if (type) where.type = type;

    const [data, total] = await Promise.all([
      this.prisma.notification.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.notification.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1,
      },
    };
  }

  async findOne(id: string, gymId: string) {
    const item = await this.prisma.notification.findFirst({ where: { id, gymId } });
    if (!item) throw new NotFoundException('Notification not found');
    return item;
  }

  async deliveryReport(gymId: string) {
    const [pending, sent, delivered, failed, read] = await Promise.all([
      this.prisma.notification.count({ where: { gymId, status: 'PENDING' } }),
      this.prisma.notification.count({ where: { gymId, status: 'SENT' } }),
      this.prisma.notification.count({ where: { gymId, status: 'DELIVERED' } }),
      this.prisma.notification.count({ where: { gymId, status: 'FAILED' } }),
      this.prisma.notification.count({ where: { gymId, status: 'READ' } }),
    ]);
    const total = pending + sent + delivered + failed + read;
    return {
      total,
      pending,
      sent,
      delivered,
      failed,
      read,
      deliveryRatePct: total ? Math.round(((sent + delivered + read) / total) * 100) : 0,
    };
  }

  // ---------- Templates ----------

  async listTemplates() {
    return this.prisma.notificationTemplate.findMany({ orderBy: { name: 'asc' } });
  }

  async upsertTemplate(dto: UpsertTemplateDto) {
    return this.prisma.notificationTemplate.upsert({
      where: { name: dto.name },
      create: dto,
      update: dto,
    });
  }

  private renderTemplate(body: string, variables: Record<string, any> = {}): string {
    return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key) => String(variables[key] ?? ''));
  }

  // ---------- Send pipeline ----------

  async send(gymId: string, dto: SendNotificationDto) {
    let title = dto.title ?? '';
    let content = dto.content ?? '';

    if (dto.templateName) {
      const template = await this.prisma.notificationTemplate.findUnique({ where: { name: dto.templateName } });
      if (!template) throw new BadRequestException(`Template "${dto.templateName}" not found`);
      title = template.subject ? this.renderTemplate(template.subject, dto.variables) : title;
      content = this.renderTemplate(template.body, dto.variables);
    }

    if (!content) throw new BadRequestException('Either templateName or content must be provided');

    const notification = await this.prisma.notification.create({
      data: {
        type: dto.type,
        channel: dto.channel,
        title: title || dto.type,
        content,
        userId: dto.userId,
        memberId: dto.memberId,
        templateId: dto.templateName,
        variables: dto.variables,
        status: 'PENDING',
        gymId,
      },
    });

    await this.dispatch(notification.id);
    return this.findOne(notification.id, gymId);
  }

  private async dispatch(notificationId: string) {
    const notification = await this.prisma.notification.findUnique({ where: { id: notificationId } });
    if (!notification) return;

    let recipient: string | null = null;
    let recipientName = 'there';
    if (notification.userId) {
      const user = await this.prisma.user.findUnique({ where: { id: notification.userId } });
      recipient = notification.channel === 'SMS' || notification.channel === 'WHATSAPP' ? user?.phone ?? null : user?.email ?? null;
      if (user?.firstName) recipientName = user.firstName;
    } else if (notification.memberId) {
      const member = await this.prisma.member.findUnique({ where: { id: notification.memberId } });
      recipient = notification.channel === 'SMS' || notification.channel === 'WHATSAPP' ? member?.mobile ?? null : member?.email ?? null;
      if (member?.firstName) recipientName = member.firstName;
    }

    let result: { success: boolean; error?: string } = { success: false, error: 'No recipient' };

    if (recipient) {
      switch (notification.channel) {
        case NotificationChannel.EMAIL:
          result = await this.email.send(recipient, notification.title, notification.content);
          break;
        case NotificationChannel.SMS:
          result = await this.sms.send(recipient, notification.content);
          break;
        case NotificationChannel.WHATSAPP:
          // WhatsApp policy requires an approved template for any
          // business-initiated message outside a 24h customer session —
          // which every one of these (check-in confirmation, payment
          // receipt, expiry reminder) is. "muscleos_alert" is the generic
          // two-variable template approved in Meta Business Manager:
          // {{1}} = recipient's name, {{2}} = the already-resolved message.
          result = await this.whatsapp.sendTemplate(recipient, 'muscleos_alert', 'en', [recipientName, notification.content]);
          break;
        case NotificationChannel.PUSH:
          result = await this.push.send(notification.userId ?? notification.memberId ?? '', notification.title, notification.content);
          break;
        case NotificationChannel.IN_APP:
          result = { success: true };
          break;
      }
    }

    await this.prisma.notification.update({
      where: { id: notificationId },
      data: result.success
        ? { status: 'SENT', sentAt: new Date() }
        : { status: 'FAILED', failedReason: result.error ?? 'Unknown error' },
    });
  }

  // ---------- Announcements (broadcast to all members of a gym) ----------

  async createAnnouncement(gymId: string, dto: CreateAnnouncementDto) {
    const members = await this.prisma.member.findMany({
      where: { gymId, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });

    const created = [];
    for (const channel of dto.channels) {
      for (const member of members) {
        const notification = await this.prisma.notification.create({
          data: {
            type: 'ANNOUNCEMENT',
            channel,
            title: dto.title,
            content: dto.content,
            memberId: member.id,
            status: dto.scheduledAt ? 'PENDING' : 'PENDING',
            gymId,
          },
        });
        created.push(notification.id);
      }
    }

    if (!dto.scheduledAt) {
      for (const id of created) await this.dispatch(id);
    }

    await this.audit.log({
      action: 'CREATE',
      entity: 'Announcement',
      newValue: { title: dto.title, recipients: members.length, channels: dto.channels },
      gymId,
    });

    return { message: `Announcement queued for ${members.length} members`, notificationIds: created };
  }

  // ---------- Scheduled reminder jobs ----------

  /** Multi-stage membership expiry reminders — 7 days before, 3 days before,
   *  1 day before, on the expiry day itself, and once after expiry. Each
   *  stage fires exactly once per membership: `reminderStagesSent` is the
   *  idempotency record, checked before send and updated right after, so a
   *  cron overlap or restart mid-run can't double-send a stage. Runs daily;
   *  stages are evaluated by days-remaining rather than by a fixed clock
   *  time so a missed run (e.g. deploy downtime) still catches up correctly
   *  the next time it executes instead of permanently skipping a stage. */
  @Cron('0 8 * * *')
  async sendMembershipExpiryReminders() {
    const STAGES: Array<{ code: string; daysFromNow: number }> = [
      { code: '7d', daysFromNow: 7 },
      { code: '3d', daysFromNow: 3 },
      { code: '1d', daysFromNow: 1 },
      { code: '0d', daysFromNow: 0 },
    ];
    const windowEnd = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    const candidates = await this.prisma.membership.findMany({
      where: { status: 'ACTIVE', endDate: { lte: windowEnd } },
      include: { member: true },
    });

    let sentCount = 0;
    for (const membership of candidates) {
      const daysLeft = Math.floor((membership.endDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
      const stage = STAGES.find((s) => daysLeft <= s.daysFromNow
        && !membership.reminderStagesSent.includes(s.code));
      if (!stage) continue;

      await this.send(membership.gymId, {
        type: 'MEMBERSHIP_EXPIRY',
        channel: 'EMAIL',
        memberId: membership.memberId,
        templateName: 'membership_expiry',
        variables: { memberName: membership.member.firstName, daysLeft, planName: membership.planName, stage: stage.code },
      }).catch((e) => this.logger.error(e.message, e.stack, 'NotificationsService'));

      await this.prisma.membership.update({
        where: { id: membership.id },
        data: {
          reminderStagesSent: { push: stage.code },
          renewalReminderSent: true, // legacy flag kept in sync for any code still reading it
        },
      });
      sentCount += 1;
    }

    this.logger.log(`Sent ${sentCount} membership expiry reminders`, 'NotificationsService');
  }

  /** Same multi-stage pattern for Gym Owner → MuscleOS platform billing
   *  (distinct from the member-facing reminder above). */
  @Cron('30 8 * * *')
  async sendPlatformSubscriptionExpiryReminders() {
    const STAGES: Array<{ code: string; daysFromNow: number }> = [
      { code: '7d', daysFromNow: 7 },
      { code: '3d', daysFromNow: 3 },
      { code: '1d', daysFromNow: 1 },
      { code: '0d', daysFromNow: 0 },
    ];
    const windowEnd = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    const candidates = await this.prisma.platformSubscription.findMany({
      where: { status: 'ACTIVE', currentPeriodEnd: { not: null, lte: windowEnd } },
      include: { gym: true },
    });

    let sentCount = 0;
    for (const sub of candidates) {
      if (!sub.currentPeriodEnd) continue;
      const daysLeft = Math.floor((sub.currentPeriodEnd.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
      const stage = STAGES.find((s) => daysLeft <= s.daysFromNow && !sub.reminderStagesSent.includes(s.code));
      if (!stage) continue;

      await this.email.send(
        sub.gym.email,
        'Your MuscleOS subscription is expiring soon',
        `<p>Hi ${sub.gym.name},</p><p>Your MuscleOS plan expires in ${Math.max(daysLeft, 0)} day(s). Please renew to avoid service interruption.</p>`,
      ).catch((e) => this.logger.error(e.message, undefined, 'NotificationsService'));

      await this.prisma.platformSubscription.update({
        where: { id: sub.id },
        data: { reminderStagesSent: { push: stage.code } },
      });
      sentCount += 1;
    }

    this.logger.log(`Sent ${sentCount} platform subscription expiry reminders`, 'NotificationsService');
  }

  /** Daily at 07:00 — birthday wishes. */
  @Cron('0 7 * * *')
  async sendBirthdayWishes() {
    const today = new Date();
    const members = await this.prisma.$queryRaw<{ id: string; firstName: string; gymId: string }[]>`
      SELECT id, "firstName", "gymId" FROM members
      WHERE "dateOfBirth" IS NOT NULL
        AND EXTRACT(MONTH FROM "dateOfBirth") = ${today.getMonth() + 1}
        AND EXTRACT(DAY FROM "dateOfBirth") = ${today.getDate()}
        AND "deletedAt" IS NULL
    `;

    for (const member of members) {
      await this.send(member.gymId, {
        type: 'BIRTHDAY',
        channel: 'EMAIL',
        memberId: member.id,
        templateName: 'birthday_wish',
        variables: { memberName: member.firstName },
      }).catch((e) => this.logger.error(e.message, e.stack, 'NotificationsService'));
    }

    this.logger.log(`Sent ${members.length} birthday wishes`, 'NotificationsService');
  }

  /** Hourly — auto-expire memberships whose endDate has passed. */
  @Cron(CronExpression.EVERY_HOUR)
  async autoExpireMemberships() {
    const result = await this.prisma.membership.updateMany({
      where: { status: 'ACTIVE', endDate: { lt: new Date() } },
      data: { status: 'EXPIRED' },
    });
    if (result.count > 0) {
      this.logger.log(`Auto-expired ${result.count} memberships`, 'NotificationsService');
    }
  }

  /** Hourly (offset 15 past) — force-closes attendance sessions left open
   *  too long (missed checkout — phone died, walked out without scanning,
   *  etc). Without this: (a) the dashboard's "currently inside" count
   *  drifts upward forever with stale entries, and (b) worse, the member
   *  is permanently unable to check in again — the partial-unique-index
   *  from Phase 2 (attendance_one_open_session_per_member) only allows ONE
   *  open session per member, so a forgotten checkout silently locks them
   *  out until something closes it. `isAutoClosed` distinguishes this from
   *  a real checkout in reports (duration shown is a ceiling, not a fact). */
  @Cron('15 * * * *')
  async forceCloseStaleAttendanceSessions() {
    const staleCutoff = new Date(Date.now() - 12 * 60 * 60 * 1000); // 12h — generous for even a long workout + shower + errands
    const stale = await this.prisma.attendance.findMany({
      where: { checkOutAt: null, checkInAt: { lt: staleCutoff } },
      select: { id: true, checkInAt: true, gymId: true, memberId: true },
    });
    if (stale.length === 0) return;

    for (const session of stale) {
      const durationMinutes = Math.round((staleCutoff.getTime() - session.checkInAt.getTime()) / 60000);
      // eslint-disable-next-line no-await-in-loop
      await this.prisma.attendance.update({
        where: { id: session.id },
        data: { checkOutAt: staleCutoff, duration: durationMinutes, isAutoClosed: true },
      });
    }
    this.logger.log(`Force-closed ${stale.length} stale attendance session(s) (missed checkout)`, 'NotificationsService');
  }

  /** Daily at 03:00 — deletes rows that only ever existed as short-lived
   *  state (already-expired refresh tokens, sessions, and revoked/expired
   *  branch QR tokens). Idempotent by construction: every WHERE clause only
   *  ever matches rows that are already dead weight, so running this twice
   *  (or missing a run) changes nothing about correctness. Recovery codes /
   *  revoked-but-recent QR tokens are kept a few extra days for audit
   *  trail purposes before being swept. */
  @Cron('0 3 * * *')
  async cleanupExpiredTokensAndSessions() {
    const now = new Date();
    const auditRetentionCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [refreshTokens, sessions, qrTokens] = await Promise.all([
      this.prisma.refreshToken.deleteMany({
        where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { lt: auditRetentionCutoff } }] },
      }),
      this.prisma.userSession.deleteMany({
        where: { OR: [{ expiresAt: { lt: now } }, { isActive: false, lastActiveAt: { lt: auditRetentionCutoff } }] },
      }),
      this.prisma.branchQrToken.deleteMany({
        where: { isActive: false, revokedAt: { lt: auditRetentionCutoff } },
      }),
    ]);

    const total = refreshTokens.count + sessions.count + qrTokens.count;
    if (total > 0) {
      this.logger.log(
        `Cleanup: removed ${refreshTokens.count} refresh tokens, ${sessions.count} sessions, ${qrTokens.count} revoked QR tokens`,
        'NotificationsService',
      );
    }
  }
}
