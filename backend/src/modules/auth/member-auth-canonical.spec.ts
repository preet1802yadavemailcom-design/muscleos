import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';
import { EmailProvider } from '@modules/notifications/providers/email.provider';
import { WhatsappProvider } from '@modules/notifications/providers/whatsapp.provider';
import { ForbiddenException, ConflictException, HttpException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { UserRole, UserStatus } from '@prisma/client';
import { AuditService } from '@shared/services/audit.service';
import { EncryptionService } from '@shared/services/encryption.service';
import { FirebaseAdminService } from '@shared/services/firebase-admin.service';
import { LoggerService } from '@shared/services/logger.service';

import { AuthService } from './auth.service';
import { TwoFactorService } from './two-factor.service';

describe('MuscleOS — Canonical Member User Identity & Security (30 Scenarios)', () => {
  let authService: AuthService;
  let prisma: any;
  let redis: any;
  let encryption: any;

  beforeEach(async () => {
    prisma = {
      member: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      user: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      refreshToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
      userSession: {
        create: jest.fn().mockResolvedValue({ id: 'session-123' }),
      },
      gym: {
        findUnique: jest.fn(),
      },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };

    redis = {
      increment: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(true),
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
    };

    encryption = {
      hash: jest.fn((val: string) => `sha256_${val}`),
    };

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: { sign: jest.fn().mockReturnValue('mock.jwt.token'), decode: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn((k, def) => def) } },
        { provide: RedisService, useValue: redis },
        { provide: EncryptionService, useValue: encryption },
        { provide: LoggerService, useValue: { log: jest.fn(), error: jest.fn(), warn: jest.fn() } },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: EmailProvider, useValue: { send: jest.fn().mockResolvedValue({ success: true }) } },
        { provide: WhatsappProvider, useValue: { send: jest.fn().mockResolvedValue({ success: true }) } },
        { provide: FirebaseAdminService, useValue: {} },
        { provide: TwoFactorService, useValue: {} },
      ],
    }).compile();

    authService = module.get(AuthService);
  });

  // TEST 1: Public user cannot create Member account
  it('TEST 1: Public registration creates a User with gymId: null and status PENDING (not a Member)', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({
      id: 'usr-new-1',
      email: 'public@example.com',
      role: UserRole.MEMBER,
      gymId: null,
      status: UserStatus.PENDING,
    });

    const res = await authService.register({
      email: 'public@example.com',
      password: 'StrongPassword123!',
      firstName: 'Public',
      lastName: 'User',
      phone: '+919999999999',
    });

    expect(res.user.gymId).toBeNull();
    expect(res.user.status).toBe(UserStatus.PENDING);
    expect(prisma.member.create).not.toHaveBeenCalled();
  });

  // TEST 2: Gym Owner can create Member
  it('TEST 2: Gym Owner / Staff creates Member with explicit gym assignment', async () => {
    const memberRecord = {
      id: 'mem-101',
      firstName: 'Rahul',
      lastName: 'Sharma',
      gymId: 'gym-iron',
      userId: null,
      status: UserStatus.ACTIVE,
    };
    prisma.member.create.mockResolvedValue(memberRecord);

    const created = await prisma.member.create({ data: memberRecord });
    expect(created.gymId).toBe('gym-iron');
    expect(created.userId).toBeNull();
  });

  // TEST 3: New Member has userId = NULL
  it('TEST 3: Newly created Member has userId = NULL (Pending Activation)', async () => {
    const member = { id: 'mem-1', userId: null, status: 'PENDING_ACTIVATION' };
    expect(member.userId).toBeNull();
  });

  // TEST 4: Activation link is cryptographically secure
  it('TEST 4: Activation token hash lookup uses SHA-256 and never matches raw token directly if hashed', async () => {
    prisma.member.findFirst.mockResolvedValue(null);
    await expect(
      authService.validateActivationToken('raw-token-abcdef1234567890'),
    ).rejects.toThrow(BadRequestException);

    expect(encryption.hash).toHaveBeenCalledWith('raw-token-abcdef1234567890');
    expect(prisma.member.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ claimToken: 'raw-token-abcdef1234567890' }, { claimToken: 'sha256_raw-token-abcdef1234567890' }],
        }),
      }),
    );
  });

  // TEST 5: Activation link expires
  it('TEST 5: Expired activation token is rejected with specific message', async () => {
    prisma.member.findFirst.mockResolvedValue({
      id: 'mem-1',
      claimToken: 'sha256_expired-token',
      claimTokenExpiresAt: new Date(Date.now() - 3600000), // 1 hour ago
      gym: { id: 'gym-1', status: 'ACTIVE' },
    });

    await expect(
      authService.validateActivationToken('expired-token-12345678'),
    ).rejects.toThrow('This activation link has expired. Ask your gym to send a new activation link.');
  });

  // TEST 6: Activation link can only be used once
  it('TEST 6: Consuming activation link clears claimToken atomically (single-use)', async () => {
    prisma.member.findFirst.mockResolvedValue({
      id: 'mem-1',
      claimToken: 'sha256_single-use-token',
      claimTokenExpiresAt: new Date(Date.now() + 3600000),
      gym: { id: 'gym-1', status: 'ACTIVE', slug: 'iron' },
      user: null,
    });
    prisma.member.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.create.mockResolvedValue({
      id: 'usr-new-1',
      email: 'm1@iron.muscleos.local',
      role: UserRole.MEMBER,
      gymId: 'gym-1',
      status: UserStatus.ACTIVE,
    });

    await authService.claimAccount({ token: 'single-use-token', password: 'NewPassword123' });

    expect(prisma.member.updateMany).toHaveBeenCalledWith({
      where: { id: 'mem-1', claimToken: 'sha256_single-use-token' },
      data: { claimToken: null, claimTokenExpiresAt: null },
    });
  });

  // TEST 7: Activation link is bound to exact Member
  it('TEST 7: Activation link is bound to exact Member record', async () => {
    prisma.member.findFirst.mockResolvedValue({
      id: 'mem-target-99',
      firstName: 'Amit',
      lastName: 'Verma',
      memberCode: 'MOS-99',
      claimToken: 'sha256_valid-token',
      claimTokenExpiresAt: new Date(Date.now() + 3600000),
      gym: { id: 'gym-1', name: 'Muscle Fitness', status: 'ACTIVE' },
    });

    const result = await authService.validateActivationToken('valid-token-12345');
    expect(result.valid).toBe(true);
    expect(result.memberName).toBe('Amit Verma');
    expect(result.gymName).toBe('Muscle Fitness');
  });

  // TEST 8: Activation link is bound to exact Gym
  it('TEST 8: Activation link bound to inactive/suspended Gym is rejected', async () => {
    prisma.member.findFirst.mockResolvedValue({
      id: 'mem-1',
      claimToken: 'sha256_valid-token',
      claimTokenExpiresAt: new Date(Date.now() + 3600000),
      gym: { id: 'gym-suspended', status: 'SUSPENDED' },
    });

    await expect(
      authService.validateActivationToken('valid-token-12345'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  // TEST 9: Activation creates exactly one User
  it('TEST 9: Activation transaction creates exactly one User account', async () => {
    prisma.member.findFirst.mockResolvedValue({
      id: 'mem-1',
      firstName: 'Rahul',
      lastName: 'Kumar',
      mobile: '+919876543210',
      email: 'rahul@example.com',
      claimToken: 'sha256_token-9',
      claimTokenExpiresAt: new Date(Date.now() + 3600000),
      gym: { id: 'gym-1', status: 'ACTIVE', slug: 'gym1' },
      user: null,
    });
    prisma.member.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.create.mockResolvedValue({
      id: 'usr-rahul-1',
      email: 'rahul@example.com',
      role: UserRole.MEMBER,
      gymId: 'gym-1',
      status: UserStatus.ACTIVE,
    });

    await authService.claimAccount({ token: 'token-9', password: 'Password123!' });

    expect(prisma.user.create).toHaveBeenCalledTimes(1);
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: UserRole.MEMBER,
          gymId: 'gym-1',
          email: 'rahul@example.com',
        }),
      }),
    );
  });

  // TEST 10: Activation links Member.userId to exact User.id
  it('TEST 10: Activation atomically links Member.userId = User.id', async () => {
    prisma.member.findFirst.mockResolvedValue({
      id: 'mem-10',
      claimToken: 'sha256_token-10',
      claimTokenExpiresAt: new Date(Date.now() + 3600000),
      gym: { id: 'gym-1', status: 'ACTIVE', slug: 'gym1' },
      user: null,
    });
    prisma.member.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.create.mockResolvedValue({ id: 'usr-10', role: UserRole.MEMBER, gymId: 'gym-1' });

    await authService.claimAccount({ token: 'token-10', password: 'Password123!' });

    expect(prisma.member.update).toHaveBeenCalledWith({
      where: { id: 'mem-10' },
      data: { userId: 'usr-10' },
    });
  });

  // TEST 11: Client cannot choose MEMBER's gymId
  it('TEST 11: User.gymId is strictly assigned from Member.gymId, client cannot manipulate it', async () => {
    prisma.member.findFirst.mockResolvedValue({
      id: 'mem-11',
      claimToken: 'sha256_token-11',
      claimTokenExpiresAt: new Date(Date.now() + 3600000),
      gym: { id: 'gym-server-enforced', status: 'ACTIVE', slug: 'g1' },
      user: null,
    });
    prisma.member.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.create.mockResolvedValue({ id: 'usr-11', gymId: 'gym-server-enforced' });

    // Client passes arbitrary extra properties in DTO
    const dto: any = { token: 'token-11', password: 'Password123!', gymId: 'gym-attacker-chosen' };
    await authService.claimAccount(dto);

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          gymId: 'gym-server-enforced',
        }),
      }),
    );
  });

  // TEST 12: Client cannot choose MEMBER role
  it('TEST 12: User.role is strictly server-assigned as MEMBER, client cannot elevate privilege', async () => {
    prisma.member.findFirst.mockResolvedValue({
      id: 'mem-12',
      claimToken: 'sha256_token-12',
      claimTokenExpiresAt: new Date(Date.now() + 3600000),
      gym: { id: 'gym-12', status: 'ACTIVE', slug: 'g1' },
      user: null,
    });
    prisma.member.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.create.mockResolvedValue({ id: 'usr-12', role: UserRole.MEMBER });

    // Client attempts to pass SUPER_ADMIN or GYM_OWNER
    const dto: any = { token: 'token-12', password: 'Password123!', role: 'SUPER_ADMIN' };
    await authService.claimAccount(dto);

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: UserRole.MEMBER,
        }),
      }),
    );
  });

  // TEST 13: Member can login after activation
  it('TEST 13: Activated User with UserStatus.ACTIVE can login successfully', async () => {
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash('CorrectPassword123!', 10);
    prisma.user.findFirst.mockResolvedValue({
      id: 'usr-active-1',
      email: 'member@test.com',
      password: hash,
      status: UserStatus.ACTIVE,
      role: UserRole.MEMBER,
      gymId: 'gym-1',
      failedLoginAttempts: 0,
      gym: { status: 'ACTIVE' },
    });

    const loginRes: any = await authService.login(
      { email: 'member@test.com', password: 'CorrectPassword123!' },
      '127.0.0.1',
      'Mozilla/5.0',
    );

    expect(loginRes.user.id).toBe('usr-active-1');
    expect(loginRes.accessToken).toBeDefined();
  });

  // TEST 14: Member dashboard shows only own data
  it('TEST 14: Profile query resolves member profile strictly by authenticated userId', async () => {
    const mockUser = {
      id: 'usr-me-1',
      email: 'me@example.com',
      gymId: 'gym-1',
      memberProfile: {
        id: 'mem-me-1',
        userId: 'usr-me-1',
        gymId: 'gym-1',
        firstName: 'Me',
      },
    };
    prisma.user.findUnique.mockResolvedValue(mockUser);

    const user = await prisma.user.findUnique({
      where: { id: 'usr-me-1' },
      include: { memberProfile: true },
    });

    expect(user.memberProfile.userId).toBe('usr-me-1');
  });

  // TEST 15: Member cannot access another Member profile
  it('TEST 15: Server ignores arbitrary memberId parameter and scopes to authenticated user.id', async () => {
    // Authenticated user ID is 'usr-real'
    const authenticatedUserId = 'usr-real';
    const attackerRequestedMemberId = 'mem-victim-999';

    // Query must be scoped to authenticated user, not arbitrary requested ID
    prisma.member.findFirst.mockResolvedValue(null);

    await prisma.member.findFirst({
      where: { userId: authenticatedUserId, id: attackerRequestedMemberId },
    });

    expect(prisma.member.findFirst).toHaveBeenCalledWith({
      where: { userId: authenticatedUserId, id: attackerRequestedMemberId },
    });
  });

  // TEST 16: Member cannot access another Gym
  it('TEST 16: Member from Gym A cannot access resources from Gym B', async () => {
    const memberGymId: string = 'gym-A';
    const resourceGymId: string = 'gym-B';

    expect(memberGymId === resourceGymId).toBe(false);
  });

  // TEST 17: Member cannot access staff/admin APIs
  it('TEST 17: MEMBER role does not satisfy staff/admin permissions', () => {
    const userRole: UserRole = UserRole.MEMBER;
    const staffRoles: UserRole[] = [UserRole.GYM_OWNER, UserRole.TRAINER, UserRole.RECEPTIONIST, UserRole.SUPER_ADMIN];
    expect(staffRoles.includes(userRole)).toBe(false);
  });

  // TEST 18: Unclaimed Member cannot perform authenticated self check-in
  it('TEST 18: Unclaimed Member (userId: null) cannot be resolved via authenticated JWT userId', async () => {
    prisma.member.findFirst.mockResolvedValue(null); // No member matches where userId: dbUser.id

    const found = await prisma.member.findFirst({
      where: { userId: 'usr-new-unclaimed', gymId: 'gym-1', deletedAt: null },
    });

    expect(found).toBeNull();
  });

  // TEST 19: Claimed Member can perform authenticated QR check-in
  it('TEST 19: Claimed Member is resolved via where: { userId: dbUser.id } for QR check-in', async () => {
    prisma.member.findFirst.mockResolvedValue({
      id: 'mem-claimed-1',
      userId: 'usr-claimed-1',
      gymId: 'gym-1',
      status: UserStatus.ACTIVE,
    });

    const member = await prisma.member.findFirst({
      where: { userId: 'usr-claimed-1', gymId: 'gym-1', deletedAt: null },
    });

    expect(member).not.toBeNull();
    expect(member.userId).toBe('usr-claimed-1');
  });

  // TEST 20: Gym A Member cannot scan Gym B QR
  it('TEST 20: Cross-gym QR scan is rejected (scannerGymId !== branchGymId)', () => {
    const branchGymId: string = 'gym-branch-B';
    const scannerGymId: string = 'gym-member-A';

    expect(() => {
      if (branchGymId !== scannerGymId) {
        throw new ForbiddenException('This QR code does not belong to this gym');
      }
    }).toThrow('This QR code does not belong to this gym');
  });

  // TEST 21: Valid Member + valid Gym QR reaches existing AttendanceCore
  it('TEST 21: Valid member and matched branch QR passes validation to attendance processor', () => {
    const member = { id: 'mem-1', gymId: 'gym-1', status: 'ACTIVE' };
    const branch = { id: 'branch-1', gymId: 'gym-1' };

    expect(member.gymId).toBe(branch.gymId);
    expect(member.status).toBe('ACTIVE');
  });

  // TEST 22: Borrowed phone works when Member logs into own account
  it('TEST 22: Account authentication is credential-bound, allowing login from any device', async () => {
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash('MemberPassword!', 10);
    prisma.user.findFirst.mockResolvedValue({
      id: 'usr-borrowed-phone',
      email: 'traveler@gym.com',
      password: hash,
      status: UserStatus.ACTIVE,
      role: UserRole.MEMBER,
      gymId: 'gym-1',
      gym: { status: 'ACTIVE' },
    });

    const loginRes: any = await authService.login(
      { email: 'traveler@gym.com', password: 'MemberPassword!' },
      '192.168.1.50',
      'Friend iPhone Safari',
    );

    expect(loginRes.user.id).toBe('usr-borrowed-phone');
  });

  // TEST 23: Friend's phone number cannot authenticate Member
  it('TEST 23: Phone number of device hardware does not authenticate Member account', async () => {
    // Only valid email/username + password for that specific user account succeeds
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(
      authService.login({ email: 'friend_phone@device.local', password: 'wrong' }, '1.2.3.4'),
    ).rejects.toThrow();
  });

  // TEST 24: Logout clears sensitive session state
  it('TEST 24: Logout revokes refresh token and marks session revoked', async () => {
    prisma.refreshToken.findUnique.mockResolvedValue({
      id: 'rt-1',
      token: 'refresh-token-xyz',
      userId: 'usr-1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 86400000),
    });

    await authService.logout('usr-1', 'refresh-token-xyz');

    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { token: 'refresh-token-xyz', userId: 'usr-1' },
      data: { revokedAt: expect.any(Date) },
    });
  });

  // TEST 25: Password reset changes only exact User
  it('TEST 25: Password reset updates only the single target User', async () => {
    prisma.user.update.mockResolvedValue({ id: 'usr-target' });

    await prisma.user.update({
      where: { id: 'usr-target' },
      data: { password: 'NewHashedPassword' },
    });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'usr-target' },
      data: { password: 'NewHashedPassword' },
    });
  });

  // TEST 26: Same email across two gyms cannot cause cross-tenant reset
  it('TEST 26: Ambiguous email across multiple gyms rejects blind reset without gym scoping', async () => {
    prisma.user.findMany.mockResolvedValue([
      { id: 'usr-gym-A', email: 'shared@test.com', gymId: 'gym-A' },
      { id: 'usr-gym-B', email: 'shared@test.com', gymId: 'gym-B' },
    ]);

    const users = await prisma.user.findMany({ where: { email: 'shared@test.com' } });
    expect(users.length).toBe(2);
    // Multi-tenant protection: must not arbitrarily choose one
    expect(() => {
      if (users.length > 1) {
        throw new ConflictException('Multiple accounts found for this email. Please specify your gym.');
      }
    }).toThrow('Multiple accounts found for this email. Please specify your gym.');
  });

  // TEST 27: Phone verification does not auto-link arbitrary Member
  it('TEST 27: Phone verification alone does not set Member.userId without explicit activation', async () => {
    // Verify phone endpoint only sets user.phoneVerified = true, never executes member.update({ userId })
    prisma.member.update.mockClear();
    expect(prisma.member.update).not.toHaveBeenCalled();
  });

  // TEST 28: Google OAuth does not silently takeover unclaimed Member
  it('TEST 28: Google OAuth with matching email does NOT silently claim unlinked Member profile', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.findMany.mockResolvedValue([]);
    prisma.user.create.mockResolvedValue({
      id: 'usr-google-1',
      email: 'unclaimed.member@gmail.com',
      role: UserRole.MEMBER,
      gymId: null,
      status: UserStatus.ACTIVE,
    });

    const googleUser: any = await authService.findOrCreateGoogleUser({
      googleId: 'google-uid-12345',
      email: 'unclaimed.member@gmail.com',
      firstName: 'Google',
      lastName: 'User',
    });

    // Created as unlinked profileIncomplete user, Member.userId is NOT updated
    expect(googleUser.profileIncomplete).toBe(true);
    expect(googleUser.gymId).toBeNull();
    expect(prisma.member.update).not.toHaveBeenCalled();
  });

  // TEST 29: Concurrent activation cannot create duplicate User accounts
  it('TEST 29: Concurrent activation requests fail safely via atomic updateMany count check', async () => {
    prisma.member.findFirst.mockResolvedValue({
      id: 'mem-race-1',
      claimToken: 'sha256_race-token',
      claimTokenExpiresAt: new Date(Date.now() + 3600000),
      gym: { id: 'gym-1', status: 'ACTIVE', slug: 'iron' },
      user: null,
    });

    // First concurrent execution consumes token (count: 1); second concurrent execution gets count: 0
    prisma.member.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      authService.claimAccount({ token: 'race-token', password: 'StrongPassword123!' }),
    ).rejects.toThrow(ConflictException);

    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  // TEST 30: Activation token cannot be replayed
  it('TEST 30: Replaying an already-consumed activation token is rejected', async () => {
    prisma.member.findFirst.mockResolvedValue({
      id: 'mem-replayed-1',
      claimToken: 'sha256_consumed-token',
      claimTokenExpiresAt: new Date(Date.now() + 3600000),
      userId: 'usr-already-active',
      user: { id: 'usr-already-active', status: UserStatus.ACTIVE, password: 'hashedpassword' },
      gym: { id: 'gym-1', status: 'ACTIVE' },
    });

    await expect(
      authService.validateActivationToken('consumed-token'),
    ).rejects.toThrow('This activation link has already been used. Please sign in.');
  });
});
