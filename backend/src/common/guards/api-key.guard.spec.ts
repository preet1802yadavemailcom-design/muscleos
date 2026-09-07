import * as crypto from 'crypto';

import { PrismaService } from '@database/prisma.service';
import { UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { ApiKeyGuard } from './api-key.guard';

describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      gymSetting: {
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    const module = await Test.createTestingModule({
      providers: [
        ApiKeyGuard,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    guard = module.get(ApiKeyGuard);
  });

  function createMockContext(headers: Record<string, string>) {
    const req = { headers, gymId: undefined, user: undefined };
    return {
      switchToHttp: () => ({
        getRequest: () => req,
      }),
      _req: req,
    } as any;
  }

  it('rejects request with missing api key header', async () => {
    const ctx = createMockContext({});
    await expect(guard.canActivate(ctx)).rejects.toThrow(new UnauthorizedException('API key required (send via x-api-key header)'));
  });

  it('rejects request with invalid prefix format', async () => {
    const ctx = createMockContext({ 'x-api-key': 'invalid_prefix_key' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(new UnauthorizedException('Invalid API key format'));
  });

  it('rejects request when hashed key is not found in database', async () => {
    prisma.gymSetting.findFirst.mockResolvedValue(null);
    const ctx = createMockContext({ 'x-api-key': 'mos_1234567890abcdef12345678' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(new UnauthorizedException('Invalid or revoked API key'));
  });

  it('accepts valid key and attaches gymId and user payload to request', async () => {
    const rawKey = 'mos_1234567890abcdef12345678';
    const hashed = crypto.createHash('sha256').update(rawKey).digest('hex');

    prisma.gymSetting.findFirst.mockResolvedValue({
      id: 'setting-1',
      gymId: 'gym-99',
      category: 'api_keys',
      key: hashed,
      value: JSON.stringify({ label: 'Webhook client' }),
    });

    const ctx = createMockContext({ 'x-api-key': rawKey });
    const result = await guard.canActivate(ctx);
    expect(result).toBe(true);
    expect(ctx._req.gymId).toBe('gym-99');
    expect(ctx._req.user).toEqual(
      expect.objectContaining({
        gymId: 'gym-99',
        isApiKey: true,
        scopes: ['*'],
      }),
    );
  });

  it('rejects expired API key', async () => {
    const rawKey = 'mos_expired1234567890abcdef';
    const hashed = crypto.createHash('sha256').update(rawKey).digest('hex');

    prisma.gymSetting.findFirst.mockResolvedValue({
      id: 'setting-expired',
      gymId: 'gym-99',
      category: 'api_keys',
      key: hashed,
      value: JSON.stringify({
        label: 'Old Key',
        expiresAt: new Date(Date.now() - 3600000).toISOString(),
      }),
    });

    const ctx = createMockContext({ 'x-api-key': rawKey });
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      new UnauthorizedException('API key has expired'),
    );
  });

  it('attaches granular scopes to user object when specified in key metadata', async () => {
    const rawKey = 'mos_scoped1234567890abcdef1';
    const hashed = crypto.createHash('sha256').update(rawKey).digest('hex');

    prisma.gymSetting.findFirst.mockResolvedValue({
      id: 'setting-scoped',
      gymId: 'gym-99',
      category: 'api_keys',
      key: hashed,
      value: JSON.stringify({
        label: 'Attendance Kiosk',
        scopes: ['checkin:create', 'members:read'],
      }),
    });
    prisma.gymSetting.update = jest.fn().mockResolvedValue({});

    const ctx = createMockContext({ 'x-api-key': rawKey });
    const result = await guard.canActivate(ctx);

    expect(result).toBe(true);
    expect(ctx._req.user.scopes).toEqual(['checkin:create', 'members:read']);
    expect(prisma.gymSetting.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'setting-scoped' },
        data: expect.objectContaining({
          value: expect.stringContaining('"lastUsedAt":'),
        }),
      }),
    );
  });
});
