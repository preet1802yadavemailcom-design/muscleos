import { HttpException, HttpStatus, ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';
import { AuditService } from '@shared/services/audit.service';
import { LoggerService } from '@shared/services/logger.service';
import { PushProvider } from '@modules/notifications/providers/push.provider';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { ProfileService } from './profile.service';

describe('ProfileService - Forensic Identity & Linking Security', () => {
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
      $transaction: jest.fn().mockImplementation((args) => {
        if (Array.isArray(args)) {
          return Promise.all(args);
        }
        if (typeof args === 'function') {
          return args(prisma);
        }
        return Promise.resolve(args);
      }),
    };

    redis = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      increment: jest.fn(),
      expire: jest.fn(),
    };

    notifications = {
      send: jest.fn().mockResolvedValue(true),
    };

    const module = await Test.createTestingModule({
      providers: [
        ProfileService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: LoggerService, useValue: { log: jest.fn(), warn: jest.fn(), error: jest.fn() } },
        { provide: PushProvider, useValue: { registerToken: jest.fn(), unregisterToken: jest.fn() } },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get<ProfileService>(ProfileService);
  });

  describe('getMine — Canonical Member Profile Resolution', () => {
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

    it('does not automatically link unlinked member matching phone/email without verified ownership', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u-attacker',
        email: 'victim@gym.com',
        phone: '9876543210',
        role: 'MEMBER',
        gymId: 'gym-1',
        memberProfile: null,
      });

      const profile = await service.getMine('u-attacker');
      expect(profile.id).toBe('u-attacker');
      expect(profile.memberProfile).toBeNull();
      expect(prisma.member.findFirst).not.toHaveBeenCalled();
      expect(prisma.member.update).not.toHaveBeenCalled();
    });

    it('User A + Member B email match (unverified) -> does not auto-link', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-a',
        email: 'member-b@example.com',
        emailVerified: false,
        role: 'MEMBER',
        gymId: 'gym-1',
        memberProfile: null,
      });

      const profile = await service.getMine('user-a');
      expect(profile.memberProfile).toBeNull();
      expect(prisma.member.update).not.toHaveBeenCalled();
    });

    it('User A + Member B phone match -> does not auto-link', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-a',
        phone: '+919876543210',
        phoneVerified: false,
        role: 'MEMBER',
        gymId: 'gym-1',
        memberProfile: null,
      });

      const profile = await service.getMine('user-a');
      expect(profile.memberProfile).toBeNull();
      expect(prisma.member.update).not.toHaveBeenCalled();
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

    it('rejects OTP dispatch if member is already linked to another account', async () => {
      redis.increment.mockResolvedValue(1);
      prisma.member.findFirst.mockResolvedValue({
        id: 'm-1',
        userId: 'u-other',
        mobile: '9876543210',
        gymId: 'gym-1',
        gym: { status: 'ACTIVE' },
      });

      await expect(service.sendLinkMemberOtp('u-1', '9876543210')).rejects.toThrow(BadRequestException);
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('dispatches 6-digit OTP via WhatsApp notifications when eligible', async () => {
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
        expect.stringMatching(/^[0-9]{6}$/),
        600,
      );
      expect(notifications.send).toHaveBeenCalledWith('gym-1', expect.objectContaining({
        memberId: 'm-1',
        channel: 'WHATSAPP',
      }));
    });
  });

  describe('linkMemberByCode — Secure Ownership Linking', () => {
    it('rejects if user already has a gymId', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u-1', gymId: 'gym-already', role: 'MEMBER' });

      await expect(
        service.linkMemberByCode('u-1', 'MOS-001', '9876543210'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects if caller is not a MEMBER role', async () => {
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

    it('rejects unverified email user from bypassing OTP requirement', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u-unverified',
        gymId: null,
        role: 'MEMBER',
        email: 'member@gym.com',
        emailVerified: false,
      });
      prisma.member.findFirst.mockResolvedValue({
        id: 'm-1',
        userId: null,
        gymId: 'gym-1',
        email: 'member@gym.com',
        gym: { status: 'ACTIVE' },
      });

      await expect(
        service.linkMemberByCode('u-unverified', 'MOS-001', '9876543210'),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows instant linking when user email is verified and matches member email', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u-verified-oauth',
        gymId: null,
        role: 'MEMBER',
        email: 'member@gym.com',
        emailVerified: true,
      });
      prisma.member.findFirst.mockResolvedValue({
        id: 'm-1',
        userId: null,
        gymId: 'gym-1',
        email: 'member@gym.com',
        gym: { status: 'ACTIVE' },
      });

      prisma.member.update.mockResolvedValue({ id: 'm-1', userId: 'u-verified-oauth' });
      prisma.user.update.mockResolvedValue({ id: 'u-verified-oauth', gymId: 'gym-1' });
      jest.spyOn(service, 'getMine').mockResolvedValue({ id: 'u-verified-oauth', gymId: 'gym-1' } as any);

      const result = await service.linkMemberByCode('u-verified-oauth', 'MOS-001', '9876543210');
      expect(prisma.member.update).toHaveBeenCalledWith({
        where: { id: 'm-1' },
        data: { userId: 'u-verified-oauth' },
      });
      expect(result.gymId).toBe('gym-1');
    });

    it('locks OTP after 5 failed verification attempts', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'u-1', gymId: null, role: 'MEMBER', email: 'other@gmail.com', emailVerified: true });
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
        emailVerified: true,
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
