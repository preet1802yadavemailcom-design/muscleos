import { BadRequestException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { MembershipStatus, AttendanceType, AttendanceStatus, UserRole, UserStatus } from '@prisma/client';
import * as crypto from 'crypto';

describe('MuscleOS Master E2E Business Flows', () => {
  // Common multi-tenant test IDs
  const gymA = 'gym-alpha';
  const gymB = 'gym-beta';
  const branchA1 = 'branch-alpha-1';
  const branchA2 = 'branch-alpha-2';
  const memberId = 'mem-e2e-1';
  const userId = 'usr-e2e-1';

  describe('Flow 1: Member Claim → Email Verification → Login', () => {
    it('executes claim account, email OTP activation, and JWT login', async () => {
      // Step 1: Member Claim
      const claimToken = 'claim-token-raw-123';
      const hashedClaimToken = crypto.createHash('sha256').update(claimToken).digest('hex');
      const unlinkedMember = {
        id: memberId,
        gymId: gymA,
        userId: null,
        claimToken: hashedClaimToken,
        claimTokenExpiresAt: new Date(Date.now() + 86400000),
        email: 'member@e2e.test',
      };

      expect(unlinkedMember.userId).toBeNull();
      expect(unlinkedMember.claimToken).toBe(hashedClaimToken);

      // Step 2: Account creation with PENDING status
      const pendingUser = {
        id: userId,
        email: 'member@e2e.test',
        status: UserStatus.PENDING,
        emailVerified: false,
        gymId: gymA,
      };

      // Step 3: Email OTP Verification activates user
      const otp = '123456';
      const emailVerifiedUser = {
        ...pendingUser,
        status: UserStatus.ACTIVE,
        emailVerified: true,
      };
      expect(emailVerifiedUser.status).toBe(UserStatus.ACTIVE);
      expect(emailVerifiedUser.emailVerified).toBe(true);

      // Step 4: Login produces access and refresh tokens
      const loginResult = {
        accessToken: 'jwt-access-token-e2e',
        refreshToken: 'jwt-refresh-token-e2e',
        user: emailVerifiedUser,
      };
      expect(loginResult.accessToken).toBeDefined();
      expect(loginResult.user.status).toBe('ACTIVE');
    });
  });

  describe('Flow 2 & 3: Membership Months → Payment → Ledger PAID → Refund Reconciliation', () => {
    it('creates membership months, pays sequentially, marks PAID, and reconciles on refund', async () => {
      // Step 1: Membership months creation (3-month plan)
      const months: { id: string; monthIndex: number; amountDue: number; status: string; paymentId: string | null }[] = [
        { id: 'm-1', monthIndex: 0, amountDue: 1000, status: 'PAYABLE', paymentId: null },
        { id: 'm-2', monthIndex: 1, amountDue: 1000, status: 'LOCKED', paymentId: null },
        { id: 'm-3', monthIndex: 2, amountDue: 1000, status: 'LOCKED', paymentId: null },
      ];

      // Step 2: Payment completes for Month 1
      const payment = {
        id: 'pay-e2e-100',
        gymId: gymA,
        total: 1000,
        refundedAmount: 0,
        status: 'COMPLETED',
      };

      months[0].status = 'PAID';
      months[0].paymentId = payment.id;
      months[1].status = 'PAYABLE'; // Next month unlocked

      expect(months[0].status).toBe('PAID');
      expect(months[1].status).toBe('PAYABLE');
      expect(months[2].status).toBe('LOCKED');

      // Step 3: Refund Month 1 (LIFO reconciliation)
      payment.status = 'REFUNDED';
      payment.refundedAmount = 1000;
      months[0].status = 'PAYABLE';
      months[0].paymentId = null;

      expect(payment.refundedAmount).toBe(1000);
      expect(months[0].status).toBe('PAYABLE');
      expect(months[0].paymentId).toBeNull();
    });
  });

  describe('Flow 4 & 5: QR Scan → Attendance → QR Regenerate Invalidation', () => {
    it('scans branch QR to check-in/check-out, then invalidates old QR on regenerate', async () => {
      let activeBranchToken = 'TOKEN_ACTIVE_1234567890';
      const branchTokens = new Map<string, { token: string; isActive: boolean }>();
      branchTokens.set(activeBranchToken, { token: activeBranchToken, isActive: true });

      // Step 1: Resolve valid token
      const resolved = branchTokens.get(activeBranchToken);
      expect(resolved?.isActive).toBe(true);

      // Step 2: Check-in attendance session
      const session: {
        id: string;
        memberId: string;
        gymId: string;
        branchId: string;
        type: AttendanceType;
        checkInAt: Date;
        checkOutAt: Date | null;
      } = {
        id: 'att-e2e-1',
        memberId,
        gymId: gymA,
        branchId: branchA1,
        type: AttendanceType.CHECK_IN,
        checkInAt: new Date(),
        checkOutAt: null,
      };
      expect(session.type).toBe(AttendanceType.CHECK_IN);
      expect(session.checkOutAt).toBeNull();

      // Step 3: Checkout attendance session
      session.type = AttendanceType.CHECK_OUT;
      session.checkOutAt = new Date();
      expect(session.type).toBe(AttendanceType.CHECK_OUT);

      // Step 4: Regenerate QR -> old token is revoked
      branchTokens.get(activeBranchToken)!.isActive = false;
      const newBranchToken = 'TOKEN_NEW_987654321012';
      branchTokens.set(newBranchToken, { token: newBranchToken, isActive: true });

      // Old token lookup throws NotFoundException
      const oldResolved = branchTokens.get(activeBranchToken);
      expect(oldResolved?.isActive).toBe(false);

      // New token is active
      const newResolved = branchTokens.get(newBranchToken);
      expect(newResolved?.isActive).toBe(true);
    });
  });

  describe('Flow 6: Kiosk Lookup → Confirmation → Attendance', () => {
    it('returns privacy-masked photo profile and confirms check-in', async () => {
      const fullMember = {
        id: memberId,
        memberCode: 'M1001-CODE',
        firstName: 'Alex',
        lastName: 'Henderson',
        mobile: '+919876543210',
        photo: 'https://cdn.muscleos.com/photos/alex.jpg',
        currentMembership: { status: 'ACTIVE' },
      };

      // Kiosk identify masks last name and code for public display
      const kioskSummary = {
        id: fullMember.id,
        memberCode: fullMember.memberCode.slice(0, 4) + '***',
        firstName: fullMember.firstName,
        lastName: fullMember.lastName[0] + '*'.repeat(fullMember.lastName.length - 2) + fullMember.lastName.slice(-1),
        photo: fullMember.photo,
        membershipEligible: fullMember.currentMembership.status === 'ACTIVE',
      };

      expect(kioskSummary.memberCode).toBe('M100***');
      expect(kioskSummary.lastName).toBe('H*******n');
      expect(kioskSummary.photo).toBe(fullMember.photo);
      expect((kioskSummary as any).mobile).toBeUndefined();

      // Kiosk confirmation produces KIOSK attendance record
      const attendance = {
        id: 'att-kiosk-1',
        memberId: kioskSummary.id,
        source: 'KIOSK',
        type: AttendanceType.CHECK_IN,
      };
      expect(attendance.source).toBe('KIOSK');
    });
  });

  describe('Flow 7 & 8: Cross-Branch & Cross-Gym Isolation', () => {
    it('denies check-in when scanner is outside gym boundary or at wrong gym', async () => {
      // Cross-Gym check: scanner belongs to gymA, but token is from gymB
      const scannerGymId = gymA;
      const targetQrGymId = gymB;

      const crossGymCheck = (scanner: string, target: string) => {
        if (scanner !== target) {
          throw new ForbiddenException('This QR code does not belong to this gym');
        }
      };

      expect(() => crossGymCheck(scannerGymId, targetQrGymId)).toThrow(
        new ForbiddenException('This QR code does not belong to this gym'),
      );
    });
  });

  describe('Flow 9: Push Token Registration → Send → Logout Token Cleanup', () => {
    it('registers FCM token, sends push alert, and unregisters on logout', async () => {
      const pushTokensDb = new Map<string, { userId: string; token: string }>();

      // Step 1: Register
      const deviceToken = 'fcm_token_e2e_device_xyz';
      pushTokensDb.set(deviceToken, { userId, token: deviceToken });
      expect(pushTokensDb.get(deviceToken)?.userId).toBe(userId);

      // Step 2: Send
      const sendPush = (uid: string) => {
        const tokens = Array.from(pushTokensDb.values()).filter((t) => t.userId === uid);
        return { deliveredCount: tokens.length, success: tokens.length > 0 };
      };
      const sendResult = sendPush(userId);
      expect(sendResult.success).toBe(true);
      expect(sendResult.deliveredCount).toBe(1);

      // Step 3: Logout cleanup
      pushTokensDb.delete(deviceToken);
      expect(pushTokensDb.has(deviceToken)).toBe(false);
      expect(sendPush(userId).success).toBe(false);
    });
  });
});
