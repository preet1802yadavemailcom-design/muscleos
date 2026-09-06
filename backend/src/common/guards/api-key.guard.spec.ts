import * as crypto from 'crypto';
import { UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@database/prisma.service';
import { ApiKeyGuard } from './api-key.guard';

describe('ApiKeyGuard', () => {
  let guard: ApiKeyGuard;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      gymSetting: {
        findFirst: jest.fn(),
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
      }),
    );
  });
});
