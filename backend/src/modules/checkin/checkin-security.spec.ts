import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';
import { AuditService } from '@shared/services/audit.service';
import { EncryptionService } from '@shared/services/encryption.service';
import { LoggerService } from '@shared/services/logger.service';
import { SequenceService } from '@shared/services/sequence.service';
import { AttendanceCoreService } from '@modules/attendance/attendance-core.service';
import { QrService } from '@modules/qr/qr.service';
import { NotificationsService } from '@modules/notifications/notifications.service';
import { CheckinService } from './checkin.service';

describe('CheckinService - Security', () => {
  let service: CheckinService;
  let prisma: any;
  let jwt: any;
  let encryption: any;

  beforeEach(async () => {
    prisma = {
      gym: {
        findUnique: jest.fn().mockResolvedValue({ id: 'gym-1', status: 'ACTIVE', deletedAt: null }),
        findFirst: jest.fn().mockResolvedValue({ id: 'gym-1', status: 'ACTIVE', deletedAt: null }),
      },
      member: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
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
        { provide: PrismaService, useValue: prisma },
        { provide: RedisService, useValue: { get: jest.fn(), set: jest.fn(), del: jest.fn() } },
        { provide: JwtService, useValue: jwt },
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue('jwt-secret') } },
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
});
