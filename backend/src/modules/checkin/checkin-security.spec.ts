import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';
import { JwtStrategy } from '@modules/auth/strategies/jwt.strategy';
import { AttendanceCoreService } from '@modules/attendance/attendance-core.service';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { QrService } from '@modules/qr/qr.service';
import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AuditService } from '@shared/services/audit.service';
import { EncryptionService } from '@shared/services/encryption.service';
import { LoggerService } from '@shared/services/logger.service';
import { SequenceService } from '@shared/services/sequence.service';

import { CheckinService } from './checkin.service';

describe('CheckinService - Security & Isolation', () => {
  let service: CheckinService;
  let jwtStrategy: JwtStrategy;
  let prisma: any;
  let jwt: any;
  let encryption: any;

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
      },
      gym: {
        findUnique: jest.fn().mockResolvedValue({ id: 'gym-1', status: 'ACTIVE', deletedAt: null }),
        findFirst: jest.fn().mockResolvedValue({ id: 'gym-1', status: 'ACTIVE', deletedAt: null }),
      },
      member: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      attendance: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      batch: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };

    jwt = {
      verifyAsync: jest.fn().mockResolvedValue({
        purpose: 'checkin-session',
        gymId: 'gym-1',
        mobile: '9876543210',
      }),
      signAsync: jest.fn().mockResolvedValue('token'),
    };

    encryption = {
      hash: jest.fn().mockReturnValue('hashed-mobile'),
      encrypt: jest.fn().mockReturnValue('encrypted-mobile'),
    };

    const module = await Test.createTestingModule({
      providers: [
        CheckinService,
        JwtStrategy,
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: { get: jest.fn().mockResolvedValue(null), set: jest.fn(), del: jest.fn() } },
        { provide: JwtService, useValue: jwt },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'app.jwtSecret') return 'jwt-secret';
              return null;
            }),
          },
        },
        { provide: EncryptionService, useValue: encryption },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: LoggerService, useValue: { log: jest.fn(), error: jest.fn(), warn: jest.fn() } },
        { provide: AttendanceCoreService, useValue: {} },
        { provide: QrService, useValue: {} },
        { provide: NotificationsService, useValue: {} },
        { provide: SequenceService, useValue: {} },
      ],
    }).compile();

    service = module.get(CheckinService);
    jwtStrategy = module.get(JwtStrategy);
  });

  describe('register', () => {
    it('rejects registration when a member with the mobile already exists at the gym', async () => {
      prisma.member.findFirst.mockResolvedValue({
        id: 'member-existing-1',
        gymId: 'gym-1',
        firstName: 'Existing',
        lastName: 'Member',
      });

      await expect(
        service.register({
          sessionToken: 'valid-session-token',
          firstName: 'Attacker',
          lastName: 'Overwrite',
        } as any),
      ).rejects.toThrow(BadRequestException);

      expect(prisma.member.update).not.toHaveBeenCalled();
      expect(prisma.member.create).not.toHaveBeenCalled();
    });
  });

  describe('identify — data minimization & privacy', () => {
    it('returns minimal visual info without raw DB id, email, address, or DOB', async () => {
      jwt.verifyAsync.mockResolvedValue({
        purpose: 'kiosk',
        gymId: 'gym-1',
      });

      prisma.member.findFirst.mockResolvedValue({
        id: 'db-member-uuid-12345',
        memberCode: 'MOS-000042',
        firstName: 'Alice',
        lastName: 'Wonderland',
        photo: 'https://example.com/photo.jpg',
        email: 'alice.private@example.com',
        dateOfBirth: new Date('1990-01-01'),
        address: '123 Secret Street',
        status: 'ACTIVE',
        batch: { id: 'batch-1', name: 'Morning' },
        currentMembership: { status: 'ACTIVE' },
      });

      const res = await service.identify({
        kioskToken: 'valid-kiosk-token',
        mobile: '9876543210',
      });

      expect(res.registered).toBe(true);
      const member = res.member as any;
      expect(member.id).toBeUndefined(); // raw id must NOT be returned
      expect(member.email).toBeUndefined();
      expect(member.dateOfBirth).toBeUndefined();
      expect(member.address).toBeUndefined();
      expect(member.firstName).toBe('Alice');
      expect(member.lastName).toBe('W********d'); // masked
      expect(member.memberCode).toBe('MOS-***'); // masked
    });
  });

  describe('checkIn', () => {
    it('rejects check-in if gym is not active', async () => {
      jwt.verifyAsync.mockResolvedValue({
        purpose: 'checkin-session',
        gymId: 'gym-suspended',
        mobile: '9876543210',
      });
      prisma.gym.findFirst.mockResolvedValue(null);

      await expect(
        service.checkIn({
          sessionToken: 'valid-session-token',
          deviceType: 'kiosk',
        } as any),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('JwtStrategy — token isolation', () => {
    it('rejects tokens carrying checkin-session purpose', async () => {
      const payload = {
        sub: 'some-user-id',
        purpose: 'checkin-session',
        gymId: 'gym-1',
      };

      await expect(jwtStrategy.validate(payload)).rejects.toThrow(UnauthorizedException);
    });

    it('rejects tokens carrying kiosk purpose', async () => {
      const payload = {
        purpose: 'kiosk',
        gymId: 'gym-1',
      };

      await expect(jwtStrategy.validate(payload)).rejects.toThrow(UnauthorizedException);
    });
  });
});
