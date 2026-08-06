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

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly logger: LoggerService,
    private readonly email: EmailProvider,
    private readonly sms: SmsProvider,
    private readonly push: PushProvider,
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
    if (notification.userId) {
      const user = await this.prisma.user.findUnique({ where: { id: notification.userId } });
      recipient = notification.channel === 'SMS' ? user?.phone ?? null : user?.email ?? null;
    } else if (notification.memberId) {
      const member = await this.prisma.member.findUnique({ where: { id: notification.memberId } });
      recipient = notification.channel === 'SMS' ? member?.mobile ?? null : member?.email ?? null;
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

  /** Daily at 08:00 — flags memberships expiring within 3 days. */
  @Cron('0 8 * * *')
  async sendMembershipExpiryReminders() {
    const soon = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const expiring = await this.prisma.membership.findMany({
      where: { status: 'ACTIVE', endDate: { lte: soon, gte: new Date() }, renewalReminderSent: false },
      include: { member: true },
    });

    for (const membership of expiring) {
      const daysLeft = Math.ceil((membership.endDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
      await this.send(membership.gymId, {
        type: 'MEMBERSHIP_EXPIRY',
        channel: 'EMAIL',
        memberId: membership.memberId,
        templateName: 'membership_expiry',
        variables: { memberName: membership.member.firstName, daysLeft, planName: membership.planName },
      }).catch((e) => this.logger.error(e.message, e.stack, 'NotificationsService'));

      await this.prisma.membership.update({ where: { id: membership.id }, data: { renewalReminderSent: true } });
    }

    this.logger.log(`Sent ${expiring.length} membership expiry reminders`, 'NotificationsService');
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
}
