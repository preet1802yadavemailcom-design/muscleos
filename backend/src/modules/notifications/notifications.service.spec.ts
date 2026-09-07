import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NotificationChannel, NotificationType } from '@prisma/client';
import { AuditService } from '@shared/services/audit.service';
import { LoggerService } from '@shared/services/logger.service';

import { AnnouncementTargetType } from './dto/send-notification.dto';
import { NotificationsService } from './notifications.service';
import { EmailProvider } from './providers/email.provider';
import { PushProvider } from './providers/push.provider';
import { SmsProvider } from './providers/sms.provider';
import { WhatsappProvider } from './providers/whatsapp.provider';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: any;
  let redis: any;
  let emailProvider: any;
  let smsProvider: any;
  let pushProvider: any;
  let whatsappProvider: any;

  beforeEach(async () => {
    prisma = {
      notification: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({ id: 'notif-1', ...data }),
        ),
        update: jest.fn().mockResolvedValue({ id: 'notif-1' }),
      },
      notificationTemplate: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn(),
        create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'tmpl-1', ...data })),
        update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'tmpl-1', ...data })),
      },
      member: {
        findMany: jest.fn().mockResolvedValue([{ id: 'm1' }, { id: 'm2' }]),
        findFirst: jest.fn(),
      },
      user: {
        findFirst: jest.fn(),
      },
    };

    redis = {
      setNx: jest.fn().mockResolvedValue(true),
    };

    emailProvider = { send: jest.fn().mockResolvedValue({ success: true }) };
    smsProvider = { send: jest.fn().mockResolvedValue({ success: true }) };
    pushProvider = { send: jest.fn().mockResolvedValue({ success: true }) };
    whatsappProvider = { sendTemplate: jest.fn().mockResolvedValue({ success: true }) };

    const module = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: LoggerService, useValue: { log: jest.fn(), error: jest.fn(), warn: jest.fn() } },
        { provide: EmailProvider, useValue: emailProvider },
        { provide: SmsProvider, useValue: smsProvider },
        { provide: PushProvider, useValue: pushProvider },
        { provide: WhatsappProvider, useValue: whatsappProvider },
      ],
    }).compile();

    service = module.get(NotificationsService);
  });

  describe('templates', () => {
    it('listTemplates queries gym-specific and global templates', async () => {
      await service.listTemplates('gym-1');
      expect(prisma.notificationTemplate.findMany).toHaveBeenCalledWith({
        where: { OR: [{ gymId: 'gym-1' }, { gymId: null }] },
        orderBy: { name: 'asc' },
      });
    });

    it('upsertTemplate creates template if not existing', async () => {
      prisma.notificationTemplate.findFirst.mockResolvedValueOnce(null);
      await service.upsertTemplate(
        {
          name: 'welcome_template',
          type: NotificationType.ANNOUNCEMENT,
          channel: NotificationChannel.EMAIL,
          body: 'Hello {{name}}',
        },
        'gym-1',
      );

      expect(prisma.notificationTemplate.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ name: 'welcome_template', gymId: 'gym-1' }),
      });
    });

    it('upsertTemplate updates template if already existing', async () => {
      prisma.notificationTemplate.findFirst.mockResolvedValueOnce({ id: 'tmpl-existing' });
      await service.upsertTemplate(
        {
          name: 'welcome_template',
          type: NotificationType.ANNOUNCEMENT,
          channel: NotificationChannel.EMAIL,
          body: 'Hello {{name}} updated',
        },
        'gym-1',
      );

      expect(prisma.notificationTemplate.update).toHaveBeenCalledWith({
        where: { id: 'tmpl-existing' },
        data: expect.objectContaining({ body: 'Hello {{name}} updated' }),
      });
    });
  });

  describe('createAnnouncement', () => {
    it('creates broadcast announcement to all active members', async () => {
      const res = await service.createAnnouncement('gym-1', {
        title: 'Gym Holiday Notice',
        content: 'Gym is closed on Monday.',
        channels: [NotificationChannel.EMAIL],
        targetType: AnnouncementTargetType.ALL_ACTIVE,
      });

      expect(prisma.member.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { gymId: 'gym-1', deletedAt: null, status: 'ACTIVE' } }),
      );
      expect(prisma.notification.create).toHaveBeenCalledTimes(2);
      expect(res.notificationIds.length).toBe(2);
    });

    it('filters members by batch when targetType is BATCH', async () => {
      await service.createAnnouncement('gym-1', {
        title: 'Morning Batch Notice',
        content: 'Morning batch timing updated.',
        channels: [NotificationChannel.SMS],
        targetType: AnnouncementTargetType.BATCH,
        batchId: 'batch-morning',
      });

      expect(prisma.member.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ batchId: 'batch-morning', status: 'ACTIVE' }),
        }),
      );
    });

    it('throws BadRequestException if batchId is missing for BATCH target', async () => {
      await expect(
        service.createAnnouncement('gym-1', {
          title: 'Batch Notice',
          content: 'Notice',
          channels: [NotificationChannel.SMS],
          targetType: AnnouncementTargetType.BATCH,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException if memberId is missing for SPECIFIC_MEMBER target', async () => {
      await expect(
        service.createAnnouncement('gym-1', {
          title: 'Member Notice',
          content: 'Notice',
          channels: [NotificationChannel.SMS],
          targetType: AnnouncementTargetType.SPECIFIC_MEMBER,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
