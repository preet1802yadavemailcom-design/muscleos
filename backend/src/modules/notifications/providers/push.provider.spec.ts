import { PushProvider } from './push.provider';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@database/prisma.service';
import { LoggerService } from '@shared/services/logger.service';

describe('PushProvider', () => {
  let provider: PushProvider;
  let configService: any;
  let prisma: any;
  let logger: any;

  beforeEach(() => {
    configService = {
      get: jest.fn((key: string, defaultVal = '') => {
        if (key === 'FIREBASE_PROJECT_ID') return 'test-project';
        if (key === 'FIREBASE_CLIENT_EMAIL') return 'service-account@test-project.iam.gserviceaccount.com';
        if (key === 'FIREBASE_PRIVATE_KEY') return '-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC5\n-----END PRIVATE KEY-----';
        return defaultVal;
      }),
    };

    prisma = {
      pushToken: {
        findMany: jest.fn(),
        upsert: jest.fn(),
        deleteMany: jest.fn(),
        delete: jest.fn(),
      },
    };

    logger = {
      warn: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
    };

    provider = new PushProvider(
      configService as unknown as ConfigService,
      prisma as unknown as PrismaService,
      logger as unknown as LoggerService,
    );
  });

  describe('registerToken', () => {
    it('upserts push token with user ID and platform', async () => {
      prisma.pushToken.upsert.mockResolvedValue({ id: 'pt-1', token: 'fcm-tok-123' });

      const res = await provider.registerToken('user-1', 'fcm-tok-123', 'web');

      expect(prisma.pushToken.upsert).toHaveBeenCalledWith({
        where: { token: 'fcm-tok-123' },
        update: { userId: 'user-1', platform: 'web' },
        create: { userId: 'user-1', token: 'fcm-tok-123', platform: 'web' },
      });
      expect(res).toEqual({ message: 'Device registered for push notifications' });
    });

    it('reassigns token to new user if the device is handed to someone else', async () => {
      await provider.registerToken('user-2', 'shared-device-token');

      expect(prisma.pushToken.upsert).toHaveBeenCalledWith({
        where: { token: 'shared-device-token' },
        update: { userId: 'user-2', platform: 'web' },
        create: { userId: 'user-2', token: 'shared-device-token', platform: 'web' },
      });
    });
  });

  describe('unregisterToken', () => {
    it('only deletes tokens belonging to the requesting user', async () => {
      prisma.pushToken.deleteMany.mockResolvedValue({ count: 1 });

      const res = await provider.unregisterToken('user-1', 'tok-abc');

      expect(prisma.pushToken.deleteMany).toHaveBeenCalledWith({
        where: { token: 'tok-abc', userId: 'user-1' },
      });
      expect(res).toEqual({ message: 'Device unregistered' });
    });
  });

  describe('send', () => {
    it('returns error gracefully if Firebase is unconfigured without throwing', async () => {
      configService.get.mockReturnValue('');
      const unconfiguredProvider = new PushProvider(
        configService as unknown as ConfigService,
        prisma as unknown as PrismaService,
        logger as unknown as LoggerService,
      );

      const res = await unconfiguredProvider.send('user-1', 'Title', 'Body');

      expect(res.success).toBe(false);
      expect(res.error).toBe('Push notifications are not configured for this deployment');
      expect(logger.warn).toHaveBeenCalled();
    });

    it('returns error if user has no registered devices', async () => {
      prisma.pushToken.findMany.mockResolvedValue([]);

      const res = await provider.send('user-no-devices', 'Title', 'Body');

      expect(res.success).toBe(false);
      expect(res.error).toBe('No registered devices for this user');
    });

    it('deletes invalid/unregistered token when FCM returns UNREGISTERED error', async () => {
      prisma.pushToken.findMany.mockResolvedValue([
        { id: 'token-db-1', token: 'stale-token', userId: 'user-1' },
      ]);

      (provider as any).cachedToken = { value: 'mock-access-token', expiresAt: Date.now() + 60000 };

      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({
          error: {
            status: 'UNREGISTERED',
            message: 'Requested entity was not found.',
          },
        }),
      });

      try {
        const res = await provider.send('user-1', 'Gym Alert', 'Your membership expires soon');

        expect(res.success).toBe(false);
        expect(prisma.pushToken.delete).toHaveBeenCalledWith({
          where: { id: 'token-db-1' },
        });
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});
