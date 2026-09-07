import { PrismaService } from '@database/prisma.service';
import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { AuditService } from '@shared/services/audit.service';
import { EncryptionService } from '@shared/services/encryption.service';
import { SequenceService } from '@shared/services/sequence.service';

import { MembersService } from './members.service';


describe('MembersService — Field-Level Privacy Protection', () => {
  let service: MembersService;
  let prisma: any;

  const gymId = 'gym-1';
  const memberId = 'member-1';

  const mockMember = {
    id: memberId,
    gymId,
    firstName: 'Alice',
    lastName: 'Smith',
    mobile: '9876543210',
    email: 'alice@example.com',
    dateOfBirth: new Date('1995-05-15'),
    address: '123 Confidential Street',
    emergencyContactName: 'Bob Smith',
    emergencyContactPhone: '9876543211',
    medicalNotes: 'Severe asthma, requires inhaler',
    allergies: 'Penicillin, Peanuts',
    medications: 'Albuterol',
    deletedAt: null,
  };

  beforeEach(async () => {
    prisma = {
      member: {
        findFirst: jest.fn(),
      },
      attendance: { count: jest.fn().mockResolvedValue(5), findMany: jest.fn().mockResolvedValue([]) },
      membership: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
      payment: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
      bodyMetric: { findMany: jest.fn().mockResolvedValue([]) },
      dietPlan: { findFirst: jest.fn().mockResolvedValue(null) },
      workoutPlan: { findFirst: jest.fn().mockResolvedValue(null) },
    };

    const module = await Test.createTestingModule({
      providers: [
        MembersService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: SequenceService, useValue: { next: jest.fn().mockResolvedValue(1) } },
        { provide: EncryptionService, useValue: {} },
      ],
    }).compile();

    service = module.get(MembersService);
  });

  it('allows GYM_OWNER to see unmasked sensitive fields', async () => {
    prisma.member.findFirst.mockResolvedValue({ ...mockMember });

    const ownerUser = {
      userId: 'user-owner',
      gymId,
      role: UserRole.GYM_OWNER,
      permissions: [],
    };

    const result = await service.findOne(memberId, gymId, ownerUser);

    expect(result.medicalNotes).toBe('Severe asthma, requires inhaler');
    expect(result.emergencyContactPhone).toBe('9876543211');
    expect(result.address).toBe('123 Confidential Street');
  });

  it('allows SUPER_ADMIN to see unmasked sensitive fields', async () => {
    prisma.member.findFirst.mockResolvedValue({ ...mockMember });

    const adminUser = {
      userId: 'user-admin',
      gymId,
      role: UserRole.SUPER_ADMIN,
      permissions: [],
    };

    const result = await service.findOne(memberId, gymId, adminUser);

    expect(result.medicalNotes).toBe('Severe asthma, requires inhaler');
    expect(result.allergies).toBe('Penicillin, Peanuts');
  });

  it('allows user with explicit members:sensitive:read permission to see unmasked fields', async () => {
    prisma.member.findFirst.mockResolvedValue({ ...mockMember });

    const staffWithPerm = {
      userId: 'user-staff',
      gymId,
      role: UserRole.RECEPTIONIST,
      permissions: ['members:sensitive:read'],
    };

    const result = await service.findOne(memberId, gymId, staffWithPerm);

    expect(result.medicalNotes).toBe('Severe asthma, requires inhaler');
    expect(result.emergencyContactPhone).toBe('9876543211');
  });

  it('masks sensitive fields for RECEPTIONIST without sensitive read permission', async () => {
    prisma.member.findFirst.mockResolvedValue({ ...mockMember });

    const receptionist = {
      userId: 'user-recep',
      gymId,
      role: UserRole.RECEPTIONIST,
      permissions: ['members:read'],
    };

    const result = await service.findOne(memberId, gymId, receptionist);

    expect(result.medicalNotes).toBeNull();
    expect(result.allergies).toEqual([]);
    expect(result.medications).toEqual([]);
    expect(result.emergencyContactPhone).toBe('[CONFIDENTIAL]');
    expect(result.emergencyContactName).toBe('[CONFIDENTIAL]');
    expect(result.address).toBe('[CONFIDENTIAL]');
    expect(result.dateOfBirth).toBeNull();
    // Non-sensitive fields remain visible
    expect(result.firstName).toBe('Alice');
    expect(result.lastName).toBe('Smith');
    expect(result.mobile).toBe('9876543210');
  });

  it('masks sensitive fields in getMember360 for TRAINER', async () => {
    prisma.member.findFirst.mockResolvedValue({ ...mockMember });

    const trainer = {
      userId: 'user-trainer',
      gymId,
      role: UserRole.TRAINER,
      permissions: ['attendance:read'],
    };

    const result = await service.getMember360(memberId, gymId, trainer);

    expect(result.member.medicalNotes).toBeNull();
    expect(result.member.emergencyContactPhone).toBe('[CONFIDENTIAL]');
    expect(result.member.firstName).toBe('Alice');
  });
});
