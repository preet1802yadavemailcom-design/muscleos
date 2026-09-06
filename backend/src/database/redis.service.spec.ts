import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service';

describe('RedisService Failure Injection & Fail-Closed Behavior', () => {
  let service: RedisService;
  let configService: any;

  beforeEach(() => {
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'app.nodeEnv') return 'test';
        if (key === 'app.redisUrl') return 'redis://127.0.0.1:6379';
        return null;
      }),
    };

    service = new RedisService(configService as unknown as ConfigService);
  });

  describe('Local/Dev Mode Fallback (Redis Down)', () => {
    it('gracefully falls back to in-memory store for basic operations', async () => {
      // Redis is not connected (isRedisUp === false)
      await service.set('test:key1', 'hello-world', 10);
      const val = await service.get('test:key1');
      expect(val).toBe('hello-world');

      const exists = await service.exists('test:key1');
      expect(exists).toBe(true);

      await service.del('test:key1');
      const afterDel = await service.get('test:key1');
      expect(afterDel).toBeNull();
    });

    it('supports setNx in dev mode using memory store', async () => {
      const first = await service.setNx('test:lock', 'locked', 10);
      expect(first).toBe(true);

      const second = await service.setNx('test:lock', 'locked', 10);
      expect(second).toBe(false);
    });
  });

  describe('Production Fail-Closed Security State (Redis Down)', () => {
    beforeEach(() => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'app.nodeEnv') return 'production';
        if (key === 'app.redisUrl') return 'redis://127.0.0.1:6379';
        return null;
      });
      // Ensure NODE_ENV is production
      (service as any).isRedisUp = false;
    });

    it('fails closed on distributed lock and idempotency setNx calls', async () => {
      const lockRes = await service.setNx('lock:payment:12345', 'locked', 60);
      expect(lockRes).toBe(false);

      const idempRes = await service.setNx('idempotency:gym-1:uuid-key', 'PENDING', 86400);
      expect(idempRes).toBe(false);

      const stepUpRes = await service.setNx('step_up:user-1:action', 'true', 300);
      expect(stepUpRes).toBe(false);
    });

    it('fails closed on security getDel calls (e.g. OTP verification)', async () => {
      const otpRes = await service.getDel('otp:+919876543210');
      expect(otpRes).toBeNull();

      const verifyOtpRes = await service.getDel('verify_otp:user@test.com');
      expect(verifyOtpRes).toBeNull();
    });

    it('returns REVOKED_FAIL_CLOSED on session and user revocation lookups', async () => {
      const sessRev = await service.get('session_revoked:sess-abc-123');
      expect(sessRev).toBe('REVOKED_FAIL_CLOSED');

      const userRev = await service.get('user_revoked:user-xyz-999');
      expect(userRev).toBe('REVOKED_FAIL_CLOSED');
    });
  });
});
