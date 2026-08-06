import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';
import { ForbiddenException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { UserRole, UserStatus } from '@prisma/client';
import { AuditService } from '@shared/services/audit.service';
import { EncryptionService } from '@shared/services/encryption.service';
import { LoggerService } from '@shared/services/logger.service';
import { EmailProvider } from '@modules/notifications/providers/email.provider';
import * as bcrypt from 'bcryptjs';

import { AuthService } from './auth.service';

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
          useValue: { sign: jest.fn().mockReturnValue('signed.jwt.token') },
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
      expect(prisma.user.updateMany).toHaveBeenCalled();
    });

    it('returns tokens + creates refresh token and device session on success', async () => {
      redis.get.mockResolvedValue(null);
      prisma.user.findFirst.mockResolvedValue(baseUser);
      const result = await service.login(
        { email: baseUser.email, password: 'Password123' } as any,
        '127.0.0.1',
        'Mozilla/5.0 Chrome/120.0',
      );
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
  });

  describe('register', () => {
    it('rejects duplicate email registration', async () => {
      prisma.user.findFirst.mockResolvedValue(baseUser);
      await expect(
        service.register({ email: baseUser.email, password: 'x', firstName: 'A', lastName: 'B' } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('creates a PENDING user and triggers a verification OTP', async () => {
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
      expect(redis.set).toHaveBeenCalledWith(
        expect.stringContaining('verify_otp:'),
        expect.any(String),
        600,
      );
      expect(result.message).toMatch(/verify/i);
    });
  });

  describe('verifyEmail', () => {
    it('rejects an invalid OTP', async () => {
      redis.get.mockResolvedValue('111111');
      await expect(
        service.verifyEmail({ email: baseUser.email, otp: '000000' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('activates the user on a matching OTP', async () => {
      redis.get.mockResolvedValue('123456');
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
});
