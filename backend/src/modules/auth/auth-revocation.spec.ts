import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';
import { JwtStrategy } from './strategies/jwt.strategy';

describe('JwtStrategy — Token Revocation Gate', () => {
  let strategy: JwtStrategy;
  let prisma: any;
  let redis: any;

  const activeUser = {
    id: 'user-1',
    email: 'user@example.com',
    firstName: 'Test',
    lastName: 'User',
    role: 'MEMBER',
    gymId: 'gym-1',
    status: 'ACTIVE',
  };

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(activeUser) },
      gym: { findFirst: jest.fn().mockResolvedValue({ status: 'ACTIVE' }) },
    };
    redis = {
      get: jest.fn(),
    };

    const module = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key) => {
              if (key === 'app.jwtSecret') return 'test-secret';
              return null;
            }),
          },
        },
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
      ],
    }).compile();

    strategy = module.get(JwtStrategy);
  });

  it('rejects a valid token issued prior to a password change / revocation event', async () => {
    const revokedAtMs = Date.now();
    // Token issued 10 seconds before revocation
    const tokenIatSec = Math.floor((revokedAtMs - 10000) / 1000);

    redis.get.mockResolvedValue(revokedAtMs.toString());

    await expect(
      strategy.validate({ sub: 'user-1', iat: tokenIatSec }),
    ).rejects.toThrow(new UnauthorizedException('Token has been revoked'));
  });

  it('allows a token issued after the revocation event', async () => {
    const revokedAtMs = Date.now() - 60000; // revoked 1 minute ago
    // Token issued 10 seconds ago (after revocation)
    const tokenIatSec = Math.floor((Date.now() - 10000) / 1000);

    redis.get.mockResolvedValue(revokedAtMs.toString());

    const result = await strategy.validate({ sub: 'user-1', iat: tokenIatSec });
    expect(result.userId).toBe('user-1');
    expect(result.role).toBe('MEMBER');
  });

  it('allows a token when no revocation key exists in Redis', async () => {
    redis.get.mockResolvedValue(null);

    const result = await strategy.validate({ sub: 'user-1', iat: Math.floor(Date.now() / 1000) });
    expect(result.userId).toBe('user-1');
  });
});
