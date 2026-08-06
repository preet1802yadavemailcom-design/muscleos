import { PrismaService } from '@database/prisma.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { UserStatus } from '@prisma/client';
import { AuditService } from '@shared/services/audit.service';
import { EncryptionService } from '@shared/services/encryption.service';

import { MembersService } from './members.service';


describe('MembersService', () => {
  let service: MembersService;
  let prisma: any;
  let audit: any;

  const gymId = 'gym-1';
  const baseDto = {
    firstName: 'Rohit',
    lastName: 'Sharma',
    mobile: '+919876543210',
  } as any;

  beforeEach(async () => {
    prisma = {
      member: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      gym: {
        findUnique: jest.fn().mockResolvedValue({ slug: 'iron-paradise' }),
      },
    };
    audit = { log: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        MembersService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
        {
          provide: EncryptionService,
          useValue: {
            generateQRCodeData: jest.fn().mockReturnValue('encrypted-qr-payload'),
            hash: jest.fn().mockReturnValue('hashed-qr-code'),
          },
        },
      ],
    }).compile();

    service = module.get(MembersService);
  });

  describe('create', () => {
    it('rejects registration when the mobile number is already used at this gym', async () => {
      prisma.member.findFirst.mockResolvedValue({ id: 'existing-member' });
      await expect(service.create(gymId, baseDto)).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.member.create).not.toHaveBeenCalled();
    });

    it('generates a member code, an encrypted QR, and a referral code on registration', async () => {
      prisma.member.findFirst.mockResolvedValue(null);
      prisma.member.create.mockImplementation(({ data }: any) => Promise.resolve(data));

      const result = await service.create(gymId, baseDto);

      expect(result.memberCode).toBe('IRON-000001');
      expect(result.qrCode).toBe('hashed-qr-code');
      expect(result.qrCodeData).toBe('encrypted-qr-payload');
      expect(result.referralCode).toBe('IRON-000001-REF');
      expect(result.status).toBe(UserStatus.ACTIVE);
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'CREATE', entity: 'Member' }));
    });

    it('never exposes the raw member id as the QR code value', async () => {
      prisma.member.findFirst.mockResolvedValue(null);
      prisma.member.create.mockImplementation(({ data }: any) => Promise.resolve(data));

      const result = await service.create(gymId, baseDto);

      expect(result.qrCode).not.toBe(result.id);
    });
  });

  describe('update', () => {
    it('rejects changing to a mobile number already used by another member', async () => {
      const existing = { id: 'member-1', mobile: '+919876543210', gymId };
      prisma.member.findFirst
        .mockResolvedValueOnce(existing) // findOne() inside update()
        .mockResolvedValueOnce({ id: 'other-member' }); // duplicate check

      await expect(
        service.update('member-1', gymId, { mobile: '+919999999999' } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('findOne', () => {
    it('throws NotFoundException for a member outside the current gym', async () => {
      prisma.member.findFirst.mockResolvedValue(null);
      await expect(service.findOne('missing', gymId)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('deactivate / reactivate / remove', () => {
    const existing = { id: 'member-1', gymId, status: UserStatus.ACTIVE };

    it('deactivates a member and logs the reason', async () => {
      prisma.member.findFirst.mockResolvedValue(existing);
      prisma.member.update.mockResolvedValue({ ...existing, status: UserStatus.INACTIVE });

      const result = await service.deactivate('member-1', gymId, 'Cancelled membership');

      expect(result.status).toBe(UserStatus.INACTIVE);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEACTIVATE', newValue: { reason: 'Cancelled membership' } }),
      );
    });

    it('reactivates a member', async () => {
      prisma.member.findFirst.mockResolvedValue({ ...existing, status: UserStatus.INACTIVE });
      prisma.member.update.mockResolvedValue({ ...existing, status: UserStatus.ACTIVE });

      const result = await service.reactivate('member-1', gymId);
      expect(result.status).toBe(UserStatus.ACTIVE);
    });

    it('soft-deletes a member, preserving history via deletedAt', async () => {
      prisma.member.findFirst.mockResolvedValue(existing);
      prisma.member.update.mockResolvedValue({ ...existing, deletedAt: new Date() });

      const result = await service.remove('member-1', gymId);

      expect(result.message).toBe('Member deleted successfully');
      expect(prisma.member.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: UserStatus.INACTIVE }) }),
      );
    });
  });

  describe('exportData', () => {
    it('flattens members into export rows', async () => {
      prisma.member.findMany.mockResolvedValue([
        {
          memberCode: 'IRON-000001',
          firstName: 'Rohit',
          lastName: 'Sharma',
          mobile: '+919876543210',
          email: 'rohit@example.com',
          status: UserStatus.ACTIVE,
          batch: { name: 'Morning Yoga' },
          trainer: { firstName: 'Amit', lastName: 'Verma' },
          currentMembership: { planName: 'Yearly', endDate: new Date('2027-01-01'), status: 'ACTIVE' },
          createdAt: new Date('2026-01-01'),
        },
      ]);

      const rows = await service.exportData(gymId, {} as any);

      expect(rows).toEqual([
        expect.objectContaining({
          memberCode: 'IRON-000001',
          name: 'Rohit Sharma',
          batch: 'Morning Yoga',
          trainer: 'Amit Verma',
          plan: 'Yearly',
        }),
      ]);
    });
  });
});
