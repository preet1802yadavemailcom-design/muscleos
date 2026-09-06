import { UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';
import { AuditService } from '@shared/services/audit.service';
import * as bcrypt from 'bcryptjs';
import { StepUpService } from './step-up.service';
import { TwoFactorService } from './two-factor.service';

describe('StepUpService', () => {
  let service: StepUpService;
  let prisma: any;
  let redis: any;
  let twoFactor: any;
  let audit: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
      },
    };
    redis = {
      set: jest.fn().mockResolvedValue('OK'),
      getDel: jest.fn(),
    };
    twoFactor = {
      verifyCode: jest.fn(),
    };
    audit = {
      log: jest.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      providers: [
        StepUpService,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: redis },
        { provide: TwoFactorService, useValue: twoFactor },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get(StepUpService);
  });

  it('successfully verifies password and sets token with action metadata', async () => {
    const hashedPassword = await bcrypt.hash('CorrectPass123!', 10);
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      password: hashedPassword,
      twoFactorEnabled: false,
      gymId: 'gym-1',
    });

    const res = await service.verify('user-1', 'CorrectPass123!', undefined, 'DELETE_GYM');
    expect(res.stepUpToken).toBeDefined();
    expect(res.expiresInSeconds).toBe(300);
    expect(redis.set).toHaveBeenCalledWith(
      expect.stringContaining('step_up:user-1:'),
      expect.stringContaining('DELETE_GYM'),
      300,
    );
  });

  it('rejects incorrect password and logs audit failure', async () => {
    const hashedPassword = await bcrypt.hash('CorrectPass123!', 10);
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      password: hashedPassword,
      twoFactorEnabled: false,
      gymId: 'gym-1',
    });

    await expect(service.verify('user-1', 'WrongPass!', undefined)).rejects.toThrow(UnauthorizedException);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'STEP_UP_AUTH_FAILED', userId: 'user-1' }),
    );
  });

  it('consumes token atomically via getDel and validates action', async () => {
    const payload = JSON.stringify({ action: 'DELETE_GYM', createdAt: Date.now() });
    redis.getDel.mockResolvedValueOnce(payload);

    const valid = await service.consume('user-1', 'token-123', 'DELETE_GYM');
    expect(valid).toBe(true);
    expect(redis.getDel).toHaveBeenCalledWith('step_up:user-1:token-123');

    // Second consume returns false (replay defense)
    redis.getDel.mockResolvedValueOnce(null);
    const replayed = await service.consume('user-1', 'token-123', 'DELETE_GYM');
    expect(replayed).toBe(false);
  });

  it('rejects consume if action does not match expected action', async () => {
    const payload = JSON.stringify({ action: 'SUSPEND_GYM', createdAt: Date.now() });
    redis.getDel.mockResolvedValueOnce(payload);

    const valid = await service.consume('user-1', 'token-123', 'DELETE_GYM');
    expect(valid).toBe(false);
  });
});
