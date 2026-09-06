import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';
import { ForbiddenException, ConflictException, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { UserRole, UserStatus } from '@prisma/client';
import { AuditService } from '@shared/services/audit.service';
import { EncryptionService } from '@shared/services/encryption.service';
import { LoggerService } from '@shared/services/logger.service';
import { EmailProvider } from '@modules/notifications/providers/email.provider';
import { WhatsappProvider } from '@modules/notifications/providers/whatsapp.provider';
import { FirebaseAdminService } from '@shared/services/firebase-admin.service';
import { TwoFactorService } from './two-factor.service';
import { AuthService } from './auth.service';

describe('AuthService — Account Claim Hardening', () => {
  let service: AuthService;
  let prisma: any;
  let redis: any;
  let encryption: any;

  beforeEach(async () => {
    prisma = {
      member: {
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      user: {
        create: jest.fn(),
        update: jest.fn(),
      },
      refreshToken: {
        create: jest.fn(),
      },
      userSession: {
        create: jest.fn().mockResolvedValue({ id: 'session-123' }),
      },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };

    redis = {
      increment: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(true),
    };

    encryption = {
      hash: jest.fn((val: string) => `hashed_${val}`),
    };

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: { sign: jest.fn().mockReturnValue('mock.jwt.token') } },
        { provide: ConfigService, useValue: { get: jest.fn((k, def) => def) } },
        { provide: RedisService, useValue: redis },
        { provide: EncryptionService, useValue: encryption },
        { provide: LoggerService, useValue: { log: jest.fn(), error: jest.fn(), warn: jest.fn() } },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: EmailProvider, useValue: { send: jest.fn().mockResolvedValue({ success: true }) } },
        { provide: WhatsappProvider, useValue: { send: jest.fn().mockResolvedValue({ success: true }) } },
        { provide: FirebaseAdminService, useValue: {} },
        { provide: TwoFactorService, useValue: {} },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  it('rate limits brute force claim attempts after 10 tries', async () => {
    redis.increment.mockResolvedValue(11);

    await expect(
      service.claimAccount({ token: 'claim-token-xyz', password: 'NewPassword123' }, '1.2.3.4'),
    ).rejects.toBeInstanceOf(HttpException);

    expect(prisma.member.findFirst).not.toHaveBeenCalled();
  });

  it('rejects claim if gym is suspended or inactive', async () => {
    prisma.member.findFirst.mockResolvedValue({
      id: 'mem-1',
      claimToken: 'hashed_claim-token-xyz',
      gym: { id: 'gym-1', status: 'SUSPENDED' },
    });

    await expect(
      service.claimAccount({ token: 'claim-token-xyz', password: 'NewPassword123' }, '1.2.3.4'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('detects concurrent claim races and throws ConflictException', async () => {
    prisma.member.findFirst.mockResolvedValue({
      id: 'mem-1',
      claimToken: 'hashed_claim-token-xyz',
      gym: { id: 'gym-1', status: 'ACTIVE', slug: 'iron-gym' },
      user: null,
      memberCode: 'MEM001',
      firstName: 'Alex',
      lastName: 'Smith',
      mobile: '9876543210',
    });

    prisma.member.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.claimAccount({ token: 'claim-token-xyz', password: 'NewPassword123' }, '1.2.3.4'),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('creates user with phoneVerified: false upon successful claim', async () => {
    prisma.member.findFirst.mockResolvedValue({
      id: 'mem-1',
      claimToken: 'hashed_claim-token-xyz',
      gym: { id: 'gym-1', status: 'ACTIVE', slug: 'iron-gym' },
      user: null,
      memberCode: 'MEM001',
      firstName: 'Alex',
      lastName: 'Smith',
      mobile: '9876543210',
      email: 'alex@example.com',
    });

    prisma.member.updateMany.mockResolvedValue({ count: 1 });
    const createdUser = {
      id: 'user-new',
      email: 'alex@example.com',
      firstName: 'Alex',
      lastName: 'Smith',
      role: UserRole.MEMBER,
      status: UserStatus.ACTIVE,
      gymId: 'gym-1',
      phoneVerified: false,
      emailVerified: true,
      twoFactorEnabled: false,
    };
    prisma.user.create.mockResolvedValue(createdUser);

    const result = await service.claimAccount({ token: 'claim-token-xyz', password: 'NewPassword123' }, '1.2.3.4');

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          phoneVerified: false,
          role: UserRole.MEMBER,
          status: UserStatus.ACTIVE,
        }),
      }),
    );
    expect(result.sessionId).toBe('session-123');
    expect(result.accessToken).toBe('mock.jwt.token');
  });
});
