import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';
import { EmailProvider } from '@modules/notifications/providers/email.provider';
import { WhatsappProvider } from '@modules/notifications/providers/whatsapp.provider';
import { ForbiddenException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { UserRole, UserStatus } from '@prisma/client';
import { AuditService } from '@shared/services/audit.service';
import { EncryptionService } from '@shared/services/encryption.service';
import { FirebaseAdminService } from '@shared/services/firebase-admin.service';
import { LoggerService } from '@shared/services/logger.service';
import * as bcrypt from 'bcryptjs';

import { AuthService } from './auth.service';
import { TwoFactorService } from './two-factor.service';


describe('AuthService', () => {
  let service: AuthService;
  let prisma: any;
  let redis: any;

  const baseUser = {
    id: 'user-1',
    email: 'owner@gym.com',
    password: '',
    role: UserRole.GYM_OWNER,
    status: UserStatus.ACTIVE,
    gymId: 'gym-1',
    loginAttempts: 0,
    lockedUntil: null,
  };

  beforeEach(async () => {
    baseUser.password = await bcrypt.hash('Password123', 4);

    prisma = {
      user: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([baseUser]),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      refreshToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      userSession: {
        create: jest.fn().mockResolvedValue({ id: 'session-1' }),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };

    redis = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn().mockReturnValue('signed.jwt.token'),
            decode: jest.fn().mockReturnValue({ sub: 'user-1' }),
          },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((key: string, fallback?: any) => fallback) },
        },
        { provide: RedisService, useValue: redis },
        { provide: EncryptionService, useValue: {} },
        { provide: LoggerService, useValue: { log: jest.fn(), error: jest.fn(), warn: jest.fn() } },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: EmailProvider, useValue: { send: jest.fn().mockResolvedValue({ success: true }) } },
        { provide: WhatsappProvider, useValue: { send: jest.fn().mockResolvedValue({ success: true }) } },
        { provide: FirebaseAdminService, useValue: { verifyPhoneToken: jest.fn() } },
        { provide: TwoFactorService, useValue: {} },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  describe('login', () => {
    it('throws when too many failed attempts have been recorded', async () => {
      redis.get.mockResolvedValueOnce('5');
      await expect(
        service.login({ email: baseUser.email, password: 'wrong' } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('throws UnauthorizedException for wrong password and increments attempts', async () => {
      redis.get.mockResolvedValue('0');
      prisma.user.findFirst.mockResolvedValue(baseUser);
      await expect(
        service.login({ email: baseUser.email, password: 'wrongpass' } as any),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(prisma.user.update).toHaveBeenCalled();
    });

    it('returns tokens + creates refresh token and device session on success', async () => {
      redis.get.mockResolvedValue(null);
      prisma.user.findFirst.mockResolvedValue(baseUser);
      // login() now returns a union (full session | 2FA-setup-required |
      // 2FA-pending) since the mandatory-Super-Admin-2FA change — baseUser
      // here has 2FA disabled so this branch is always the full-session
      // shape at runtime; narrow explicitly so the assertions below
      // type-check against that shape rather than the union.
      const result = await service.login(
        { email: baseUser.email, password: 'Password123' } as any,
        '127.0.0.1',
        'Mozilla/5.0 Chrome/120.0',
      ) as { accessToken: string; sessionId: string; user: any };
      expect(result.accessToken).toBe('signed.jwt.token');
      expect(result.sessionId).toBe('session-1');
      expect(prisma.refreshToken.create).toHaveBeenCalled();
      expect(prisma.userSession.create).toHaveBeenCalled();
      expect(result.user.password).toBeUndefined();
    });

    it('uses a 30-day refresh window when rememberMe is set', async () => {
      redis.get.mockResolvedValue(null);
      prisma.user.findFirst.mockResolvedValue(baseUser);
      await service.login(
        { email: baseUser.email, password: 'Password123', rememberMe: true } as any,
        '127.0.0.1',
      );
      const createArgs = prisma.refreshToken.create.mock.calls[0][0].data;
      const days = Math.round(
        (createArgs.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      );
      expect(days).toBeGreaterThanOrEqual(29);
    });

    it('returns requiresGymSelection when user matches multiple gyms without gymId', async () => {
      redis.get.mockResolvedValue(null);
      prisma.user.findMany.mockResolvedValueOnce([
        { ...baseUser, id: 'u1', gym: { id: 'gym-1', name: 'Downtown Gym', logo: null } },
        { ...baseUser, id: 'u2', gym: { id: 'gym-2', name: 'Uptown Gym', logo: null } },
      ]);

      const res = await service.login({ email: baseUser.email, password: 'Password123' } as any);
      expect(res).toEqual(
        expect.objectContaining({
          requiresGymSelection: true,
          gyms: expect.arrayContaining([
            expect.objectContaining({ id: 'gym-1', name: 'Downtown Gym' }),
            expect.objectContaining({ id: 'gym-2', name: 'Uptown Gym' }),
          ]),
        }),
      );
    });
  });

  describe('register', () => {
    it('rejects duplicate email registration', async () => {
      prisma.user.findFirst.mockResolvedValue(baseUser);
      await expect(
        service.register({ email: baseUser.email, password: 'x', firstName: 'A', lastName: 'B' } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('creates a PENDING user for Firebase phone verification', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ ...baseUser, status: UserStatus.PENDING });
      redis.get.mockResolvedValue(null);
      const result = await service.register({
        email: 'new@gym.com',
        password: 'Password123',
        firstName: 'New',
        lastName: 'User',
      } as any);
      expect(prisma.user.create).toHaveBeenCalled();

      expect(result.user.status).toBe(UserStatus.PENDING);
      expect(result.message).toMatch(/phone/i);
    });
  });

  describe('verifyEmail', () => {
    it('rejects an invalid OTP', async () => {
      redis.get.mockImplementation(async (key: string) => {
        if (key.startsWith('verify_otp_attempts:')) return '0';
        if (key.startsWith('verify_otp:')) return '111111';
        return null;
      });
      await expect(
        service.verifyEmail({ email: baseUser.email, otp: '000000' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('activates the user on a matching OTP', async () => {
      redis.get.mockImplementation(async (key: string) => {
        if (key.startsWith('verify_otp_attempts:')) return '0';
        if (key.startsWith('verify_otp:')) return '123456';
        return null;
      });
      prisma.user.findFirst.mockResolvedValue({ ...baseUser, status: UserStatus.PENDING });
      const result = await service.verifyEmail({ email: baseUser.email, otp: '123456' });
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ emailVerified: true }) }),
      );
      expect(result.message).toMatch(/verified/i);
    });
  });

  describe('sessions', () => {
    it('lists only active, non-expired sessions', async () => {
      prisma.userSession.findMany.mockResolvedValue([{ id: 's1' }]);
      const result = await service.listSessions('user-1');
      expect(result).toEqual([{ id: 's1' }]);
      expect(prisma.userSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ userId: 'user-1', isActive: true }) }),
      );
    });

    it('throws when revoking a session that does not belong to the user', async () => {
      prisma.userSession.findFirst.mockResolvedValue(null);
      await expect(service.revokeSession('user-1', 'not-mine')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('revokes a valid session', async () => {
      prisma.userSession.findFirst.mockResolvedValue({ id: 's1', userId: 'user-1' });
      const result = await service.revokeSession('user-1', 's1');
      expect(prisma.userSession.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { isActive: false },
      });
      expect(result.message).toMatch(/revoked/i);
    });
  });

  describe('refreshToken', () => {
    const validStoredToken = {
      id: 'rt-1',
      token: 'valid-refresh-token',
      userId: 'user-1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 86400000),
      user: {
        ...baseUser,
        gym: { id: 'gym-1', status: 'ACTIVE', deletedAt: null },
      },
    };

    it('successfully rotates refresh token when active', async () => {
      redis.get.mockResolvedValue(null);
      prisma.refreshToken.findUnique.mockResolvedValue(validStoredToken);
      prisma.refreshToken.update.mockResolvedValue({});
      prisma.refreshToken.create.mockResolvedValue({});

      const tokens = await service.refreshToken({ refreshToken: 'valid-refresh-token' });
      expect(tokens.accessToken).toBe('signed.jwt.token');
      expect(tokens.refreshToken).toBe('signed.jwt.token');
      expect(prisma.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'rt-1' }, data: expect.objectContaining({ revokedAt: expect.any(Date) }) }),
      );
    });

    it('rejects refresh when user is inactive or suspended', async () => {
      redis.get.mockResolvedValue(null);
      prisma.refreshToken.findUnique.mockResolvedValue({
        ...validStoredToken,
        user: { ...validStoredToken.user, status: UserStatus.SUSPENDED },
      });

      await expect(
        service.refreshToken({ refreshToken: 'valid-refresh-token' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects refresh when gym is suspended', async () => {
      redis.get.mockResolvedValue(null);
      prisma.refreshToken.findUnique.mockResolvedValue({
        ...validStoredToken,
        user: { ...validStoredToken.user, gym: { id: 'gym-1', status: 'SUSPENDED', deletedAt: null } },
      });

      await expect(
        service.refreshToken({ refreshToken: 'valid-refresh-token' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects refresh when session has been revoked in redis', async () => {
      redis.get.mockImplementation(async (key: string) => {
        if (key.startsWith('user_revoked_at:')) return Date.now().toString();
        return null;
      });
      prisma.refreshToken.findUnique.mockResolvedValue(validStoredToken);

      await expect(
        service.refreshToken({ refreshToken: 'valid-refresh-token' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('Session Management & Revocation', () => {
    it('revokes single session in DB and Redis when requested by owner', async () => {
      prisma.userSession.findFirst.mockResolvedValue({ id: 'sess-target', userId: 'user-1' });

      const res = await service.revokeSession('user-1', 'sess-target');

      expect(prisma.userSession.update).toHaveBeenCalledWith({
        where: { id: 'sess-target' },
        data: { isActive: false },
      });
      expect(redis.set).toHaveBeenCalledWith('session_revoked:sess-target', '1', 86400);
      expect(res).toEqual({ message: 'Session revoked' });
    });

    it('revokeAllOtherSessions preserves caller current session and revokes all others', async () => {
      const otherSessions = [{ id: 'sess-other-1' }, { id: 'sess-other-2' }];
      prisma.userSession.findMany.mockResolvedValue(otherSessions);

      const res = await service.revokeAllOtherSessions('user-1', 'current-sess-id');

      // Verifies findMany excluded current session
      expect(prisma.userSession.findMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          isActive: true,
          id: { not: 'current-sess-id' },
        },
        select: { id: true },
      });

      // Verifies Redis blacklisted only the other sessions
      expect(redis.set).toHaveBeenCalledWith('session_revoked:sess-other-1', '1', 86400);
      expect(redis.set).toHaveBeenCalledWith('session_revoked:sess-other-2', '1', 86400);
      expect(redis.set).not.toHaveBeenCalledWith('session_revoked:current-sess-id', expect.anything(), expect.anything());

      // Verifies DB updated only other sessions
      expect(prisma.userSession.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          isActive: true,
          id: { not: 'current-sess-id' },
        },
        data: { isActive: false },
      });

      // Verifies refresh tokens for other sessions were revoked
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          revokedAt: null,
          NOT: { deviceInfo: { startsWith: 'session:current-sess-id|' } },
        },
        data: { revokedAt: expect.any(Date) },
      });

      expect(res).toEqual({ message: 'All other sessions revoked' });
    });
  });
});





