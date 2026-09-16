import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { PushProvider } from '@modules/notifications/providers/push.provider';
import { BadRequestException, ForbiddenException, HttpException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AuditService } from '@shared/services/audit.service';
import { LoggerService } from '@shared/services/logger.service';

import { ProfileService } from './profile.service';

describe('ProfileService — Self-Service & Linking Hardening', () => {
  let service: ProfileService;
  let prisma: any;
  let redis: any;
  let notifications: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      member: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(async (callbackOrArr) => {
        if (Array.isArray(callbackOrArr)) return Promise.all(callbackOrArr);
        return callbackOrArr(prisma);
      }),
    };

    redis = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      increment: jest.fn().mockResolvedValue(1),
      expire: jest.fn(),
    };

    notifications = {
      send: jest.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      providers: [
        ProfileService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: PushProvider, useValue: { registerToken: jest.fn(), unregisterToken: jest.fn() } },
        { provide: LoggerService, useValue: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get(ProfileService);
  });

  describe('getMine — Self-Healing Member Profile', () => {
    it('returns linked member profile directly when present', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u-1',
        email: 'user@gym.com',
        role: 'MEMBER',
        gymId: 'gym-1',
        memberProfile: { id: 'm-1', memberCode: 'MOS-001' },
      });

      const profile = await service.getMine('u-1');
      expect(profile.id).toBe('u-1');
      expect(profile.memberProfile).toBeDefined();
      expect(prisma.member.findFirst).not.toHaveBeenCalled();
    });

    it('self-heals and links unlinked member matching phone/email when memberProfile is null', async () => {
      prisma.user.findUnique
        .mockResolvedValueOnce({
          id: 'u-1',
          email: 'unlinked@gym.com',
          phone: '9876543210',
          role: 'MEMBER',
          gymId: 'gym-1',
          memberProfile: null,
        })
        .mockResolvedValueOnce({
          id: 'u-1',
          email: 'unlinked@gym.com',
          phone: '9876543210',
          role: 'MEMBER',
          gymId: 'gym-1',
          memberProfile: { id: 'm-unlinked-1', memberCode: 'MOS-999' },
        });

      prisma.member.findFirst.mockResolvedValue({
        id: 'm-unlinked-1',
        gymId: 'gym-1',
        userId: null,
        mobile: '9876543210',
      });

      prisma.member.update.mockResolvedValue({ id: 'm-unlinked-1', userId: 'u-1' });

      const profile = await service.getMine('u-1');
      expect(prisma.member.findFirst).toHaveBeenCalledWith({
        where: {
          gymId: 'gym-1',
          userId: null,
          deletedAt: null,
          OR: [{ email: 'unlinked@gym.com' }, { mobile: '9876543210' }],
        },
      });
      expect(prisma.member.update).toHaveBeenCalledWith({
        where: { id: 'm-unlinked-1' },
        data: { userId: 'u-1' },
      });
      expect(profile.memberProfile).toBeDefined();
    });
  });

  describe('sendLinkMemberOtp — Hardened Verification Code Flow', () => {
    it('rate limits OTP requests after 5 attempts', async () => {
      redis.increment.mockResolvedValue(6);

      await expect(service.sendLinkMemberOtp('u-1', '9876543210')).rejects.toThrow(HttpException);
      expect(prisma.member.findFirst).not.toHaveBeenCalled();
    });

    it('rejects OTP dispatch if member gym is suspended or inactive', async () => {
      redis.increment.mockResolvedValue(1);
      prisma.member.findFirst.mockResolvedValue({
        id: 'm-1',
        mobile: '9876543210',
        gymId: 'gym-suspended',
        gym: { status: 'SUSPENDED' },
      });

      await expect(service.sendLinkMemberOtp('u-1', '9876543210')).rejects.toThrow(ForbiddenException);
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('generates OTP, stores in Redis with TTL, and dispatches notification', async () => {
      redis.increment.mockResolvedValue(1);
      prisma.member.findFirst.mockResolvedValue({
        id: 'm-1',
        mobile: '9876543210',
        gymId: 'gym-1',
        gym: { status: 'ACTIVE' },
      });

      const res = await service.sendLinkMemberOtp('u-1', '9876543210');
      expect(res.success).toBe(true);
      expect(redis.set).toHaveBeenCalledWith(
        'link_otp:9876543210',
        expect.stringMatching(/^\d{6}$/),
        600,
      );
      expect(notifications.send).toHaveBeenCalledWith('gym-1', expect.objectContaining({
        memberId: 'm-1',
        title: 'Profile Linking Code',
      }));
    });
  });

  describe('linkMemberByCode — Anti-IDOR & Account Linking Security', () => {
    it('rejects if account is already linked to a gym', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u-1',
        gymId: 'existing-gym',
        role: 'MEMBER',
      });

      await expect(
        service.linkMemberByCode('u-1', 'MOS-001', '9876543210'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects if user role is not MEMBER', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u-admin',
        gymId: null,
        role: 'SUPER_ADMIN',
      });

      await expect(
        service.linkMemberByCode('u-admin', 'MOS-001', '9876543210'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects if member profile is already linked to another account', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u-attacker', gymId: null, role: 'MEMBER' });
      prisma.member.findFirst.mockResolvedValue({
        id: 'm-victim',
        userId: 'u-legitimate-owner',
        gymId: 'gym-1',
        gym: { status: 'ACTIVE' },
      });

      await expect(
        service.linkMemberByCode('u-attacker', 'MOS-001', '9876543210', '123456'),
      ).rejects.toThrow(BadRequestException);
    });

    it('locks OTP after 5 failed verification attempts', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u-1', gymId: null, role: 'MEMBER', email: 'other@gmail.com' });
      prisma.member.findFirst.mockResolvedValue({
        id: 'm-1',
        userId: null,
        gymId: 'gym-1',
        email: 'original@gmail.com',
        gym: { status: 'ACTIVE' },
      });

      redis.increment.mockResolvedValue(6);

      await expect(
        service.linkMemberByCode('u-1', 'MOS-001', '9876543210', 'wrong-code'),
      ).rejects.toThrow(HttpException);

      expect(redis.del).toHaveBeenCalledWith('link_otp:9876543210');
    });

    it('successfully links member and updates user gymId when OTP is verified', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u-1',
        gymId: null,
        role: 'MEMBER',
        email: 'other@gmail.com',
      });
      prisma.member.findFirst.mockResolvedValue({
        id: 'm-1',
        userId: null,
        gymId: 'gym-1',
        email: 'original@gmail.com',
        gym: { status: 'ACTIVE' },
      });

      redis.increment.mockResolvedValue(1);
      redis.get.mockResolvedValue('654321');

      prisma.member.update.mockResolvedValue({ id: 'm-1', userId: 'u-1' });
      prisma.user.update.mockResolvedValue({ id: 'u-1', gymId: 'gym-1' });

      jest.spyOn(service, 'getMine').mockResolvedValue({ id: 'u-1', gymId: 'gym-1' } as any);

      const result = await service.linkMemberByCode('u-1', 'MOS-001', '9876543210', '654321');

      expect(prisma.member.update).toHaveBeenCalledWith({
        where: { id: 'm-1' },
        data: { userId: 'u-1' },
      });
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'u-1' },
        data: { gymId: 'gym-1' },
      });
      expect(redis.del).toHaveBeenCalledWith('link_otp:9876543210');
      expect(result.gymId).toBe('gym-1');
    });
  });
});