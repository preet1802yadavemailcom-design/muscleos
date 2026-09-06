import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { AuditService } from '@shared/services/audit.service';
import { EncryptionService } from '@shared/services/encryption.service';
import { SequenceService } from '@shared/services/sequence.service';
import { AttendanceCoreService } from './attendance-core.service';
import { QrService } from '@modules/qr/qr.service';
import { AttendanceService } from './attendance.service';

describe('AttendanceService - Role Isolation', () => {
  let service: AttendanceService;
  let qrService: any;
  let prisma: any;

  beforeEach(async () => {
    qrService = {
      verifyAndDecode: jest.fn().mockResolvedValue({
        gymId: 'gym-1',
        memberId: 'member-target-1',
      }),
    };

    prisma = {
      member: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'member-target-1',
          gymId: 'gym-1',
          firstName: 'John',
          lastName: 'Doe',
          status: UserStatus.ACTIVE,
          currentMembership: { status: 'ACTIVE', endDate: new Date(Date.now() + 86400000) },
        }),
      },
    };

    const encryption = {
      decodeQRCodeData: jest.fn().mockReturnValue({
        kind: 'member',
        gymId: 'gym-1',
        memberId: 'member-target-1',
        timestamp: Date.now(),
      }),
    };

    const module = await Test.createTestingModule({
      providers: [
        AttendanceService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: EncryptionService, useValue: encryption },
        { provide: AttendanceCoreService, useValue: { recordEvent: jest.fn() } },
        { provide: QrService, useValue: qrService },
        { provide: SequenceService, useValue: {} },
      ],
    }).compile();

    service = module.get(AttendanceService);
  });

  describe('scan with member QR card (other-device)', () => {
    it('rejects attendance scan when initiated by a MEMBER role', async () => {
      const memberUser = {
        userId: 'user-member-1',
        role: UserRole.MEMBER,
        gymId: 'gym-1',
        email: 'member@test.com',
        permissions: [],
      };

      await expect(
        service.scan(
          'gym-1',
          { qrCodeData: 'enc:member-card-qr', confirmed: true },
          memberUser as any,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows attendance confirmation gate when initiated by RECEPTIONIST staff', async () => {
      const staffUser = {
        userId: 'user-staff-1',
        role: UserRole.RECEPTIONIST,
        gymId: 'gym-1',
        email: 'staff@test.com',
        permissions: [],
      };

      // When confirmed is false, returns confirmation prompt
      const result = await service.scan(
        'gym-1',
        { qrCodeData: 'enc:member-card-qr', confirmed: false },
        staffUser as any,
      );

      expect(result).toHaveProperty('requiresConfirmation', true);
      expect((result as any).member.id).toBe('member-target-1');
    });
  });
});
