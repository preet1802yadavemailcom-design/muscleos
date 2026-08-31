import { randomUUID } from 'crypto';

import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';
import {
  Injectable, BadRequestException, NotFoundException, ForbiddenException, UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  AttendanceType, MembershipPlan, MembershipStatus,
  UserStatus,
} from '@prisma/client';
import { AuditService } from '@shared/services/audit.service';
import { EncryptionService } from '@shared/services/encryption.service';
import { LoggerService } from '@shared/services/logger.service';
import { Decimal } from '@prisma/client/runtime/library';

import {
  ScanCheckinDto, IdentifyMemberDto, SendOtpDto, VerifyOtpDto,
  RegisterMemberDto, CheckinActionDto,
} from './dto';
import { distanceMeters } from '@common/utils/geo.util';
import { AttendanceCoreService } from '@modules/attendance/attendance-core.service';
import { QrService } from '@modules/qr/qr.service';

const KIOSK_TOKEN_TTL = 10 * 60; // seconds
const SESSION_TOKEN_TTL = 12 * 60 * 60; // seconds — issued once per kiosk identification

interface KioskPayload { purpose: 'kiosk'; gymId: string; branchId?: string }
interface SessionPayload { purpose: 'checkin-session'; gymId: string; mobile: string; branchId?: string }

@Injectable()
export class CheckinService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly encryption: EncryptionService,
    private readonly audit: AuditService,
    private readonly logger: LoggerService,
    private readonly attendanceCore: AttendanceCoreService,
    private readonly qr: QrService,
  ) {}

  /* ------------------------------------------------------------------ */
  /* Step 1 — scan the entrance QR                                       */
  /* ------------------------------------------------------------------ */

  /** Validates the branch QR and issues a short-lived kiosk token. The QR is
   *  a permanent, wall-printable opaque token (see qr.service.ts) — clients
   *  only ever hold the short-lived kiosk token, never the branch token or
   *  any gym identifier directly. */
  async scan(dto: ScanCheckinDto) {
    // New format: opaque DB-backed branch token (no colons — see QrService.mintUniqueToken).
    // Legacy format: AES-encrypted `gym:<gymId>[:timestamp]` payload from
    // already-printed posters, kept working during the migration window but
    // logged so they can be tracked down and reprinted with real branch QRs
    // (legacy posters have no branchId, no revoke capability, and no
    // per-branch geofence — they should be phased out).
    let gymId: string;
    let branchId: string | undefined;

    if (!dto.qrCodeData.includes(':')) {
      const resolved = await this.qr.resolveToken(dto.qrCodeData);
      gymId = resolved.gym.id;
      branchId = resolved.branch.id;
    } else {
      // The old static "gym" QR format (colon-delimited encrypted payload)
      // is fully retired — kiosk check-in only ever used that kind, and it
      // had no real revoke capability (see attendance.service.ts#scan for
      // the full explanation), so it's rejected outright rather than kept
      // as a "legacy but working" fallback.
      throw new BadRequestException('This QR code is no longer valid — please use the current branch QR poster.');
    }

    const gym = await this.prisma.gym.findFirst({
      where: { id: gymId, status: 'ACTIVE', deletedAt: null },
      select: { id: true, name: true, slug: true, logo: true, address: true, city: true, state: true },
    });
    if (!gym) throw new NotFoundException('Gym not found or not active');

    const kioskToken = await this.signToken<KioskPayload>(
      { purpose: 'kiosk', gymId: gym.id, branchId },
      KIOSK_TOKEN_TTL,
    );

    await this.audit.log({
      action: 'KIOSK_SCAN',
      entity: 'Gym',
      entityId: gym.id,
      newValue: { deviceType: dto.deviceType, location: dto.location, branchId },
      gymId: gym.id,
    });

    return { gym, kioskToken, expiresIn: KIOSK_TOKEN_TTL };
  }

  /* ------------------------------------------------------------------ */
  /* Step 2 — identify by mobile number                                  */
  /* ------------------------------------------------------------------ */

  /** Looks up a member by mobile/member-code. Returns their full profile
   *  (including photo, for staff to visually confirm on the kiosk screen)
   *  plus today's attendance state, and issues a session token straight
   *  away — no OTP step. Identity is confirmed by staff matching the
   *  displayed photo to the person in front of them, not by a one-time
   *  code. If a valid session token is already held, it's reused as-is. */
  async identify(dto: IdentifyMemberDto, sessionToken?: string) {
    const kiosk = await this.verifyToken<KioskPayload>(dto.kioskToken, 'kiosk');
    const mobile = dto.mobile.trim();

    if (sessionToken) {
      try {
        const session = await this.verifyToken<SessionPayload>(sessionToken, 'checkin-session');
        if (session.gymId === kiosk.gymId && session.mobile === mobile) {
          const member = await this.findMemberByMobile(kiosk.gymId, mobile);
          if (member) {
            return {
              registered: true,
              sessionValid: true,
              sessionToken,
              member: this.memberSummary(member),
              today: await this.todayState(kiosk.gymId, member.id),
            };
          }
        }
      } catch {
        // Invalid/expired session token — fall through to issuing a fresh one.
      }
    }

    const member = await this.findMemberByMobile(kiosk.gymId, mobile);
    if (!member) {
      // New member — still issue a session token (scoped to this mobile) so
      // the kiosk can proceed straight to the registration step without OTP.
      const newMemberSessionToken = await this.signToken<SessionPayload>(
        { purpose: 'checkin-session', gymId: kiosk.gymId, mobile, branchId: kiosk.branchId },
        SESSION_TOKEN_TTL,
      );
      return {
        registered: false,
        sessionValid: true,
        sessionToken: newMemberSessionToken,
        expiresIn: SESSION_TOKEN_TTL,
        member: null,
        today: null,
      };
    }

    // No OTP: full profile (with photo) is returned immediately so the kiosk
    // UI can display it large for staff to visually match against the person
    // checking in, and a session token is issued in the same step.
    const newSessionToken = await this.signToken<SessionPayload>(
      { purpose: 'checkin-session', gymId: kiosk.gymId, mobile, branchId: kiosk.branchId },
      SESSION_TOKEN_TTL,
    );
    await this.audit.log({
      action: 'MEMBER_IDENTIFIED',
      entity: 'Member',
      entityId: member.id,
      newValue: { mobile, method: 'photo-confirm' },
      gymId: kiosk.gymId,
    });

    return {
      registered: true,
      sessionValid: true,
      sessionToken: newSessionToken,
      expiresIn: SESSION_TOKEN_TTL,
      member: this.memberSummary(member),
      today: await this.todayState(kiosk.gymId, member.id),
    };
  }

  /* ------------------------------------------------------------------ */
  /* Step 3 — OTP                                                        */
  /* ------------------------------------------------------------------ */

  /** @deprecated OTP flow removed — kiosk identification now happens via
   *  `identify()`, which issues a session token immediately and relies on
   *  staff visually matching the returned photo. Kept only so old kiosk
   *  frontend builds fail loudly (410) instead of silently breaking, until
   *  every kiosk is updated to the new flow. Safe to delete afterward. */
  async sendOtp(_dto: SendOtpDto): Promise<never> {
    throw new BadRequestException('OTP check-in has been removed. Please update the kiosk app — identification now happens via member lookup + photo confirmation.');
  }

  /** @deprecated see sendOtp() above. */
  async verifyOtp(_dto: VerifyOtpDto): Promise<never> {
    throw new BadRequestException('OTP check-in has been removed. Please update the kiosk app — identification now happens via member lookup + photo confirmation.');
  }

  /* ------------------------------------------------------------------ */
  /* Step 4 — new member registration (auto check-in)                    */
  /* ------------------------------------------------------------------ */

  /** Creates the member profile + a pending-approval membership, then
   *  automatically checks the member in. Reuses an existing profile if the
   *  mobile is already known to the gym (no duplicates). */
  async register(dto: RegisterMemberDto, ipAddress?: string, userAgent?: string) {
    const session = await this.verifyToken<SessionPayload>(dto.sessionToken, 'checkin-session');
    await this.assertGymActive(session.gymId);
    const mobile = session.mobile;

    const existing = await this.findMemberByMobile(session.gymId, mobile);
    const member = existing
      ? await this.prisma.member.update({
          where: { id: existing.id },
          data: {
            firstName: dto.firstName,
            lastName: dto.lastName,
            ...(dto.email ? { email: dto.email } : {}),
            ...(dto.gender ? { gender: dto.gender } : {}),
            ...(dto.dateOfBirth ? { dateOfBirth: new Date(dto.dateOfBirth) } : {}),
            ...(dto.photo ? { photo: dto.photo } : {}),
            ...(dto.address ? { address: dto.address } : {}),
            ...(dto.city ? { city: dto.city } : {}),
            ...(dto.state ? { state: dto.state } : {}),
            ...(dto.pincode ? { pincode: dto.pincode } : {}),
            status: UserStatus.ACTIVE,
          },
          include: { currentMembership: true },
        })
      : await this.createMemberWithPendingMembership(session.gymId, dto, mobile);

    // Auto check-in after successful registration — but never create a
    // duplicate: if today already has an open or completed record, surface it
    // instead of writing a second CHECK_IN row.
    const state = await this.todayState(session.gymId, member.id);
    const attendance = state.checkedIn
      ? {
          id: state.recordId,
          type: AttendanceType.CHECK_IN,
          status: 'PRESENT',
          checkInAt: state.checkedIn,
          checkOutAt: state.checkOutAt,
          isLate: false,
          lateMinutes: 0,
          alreadyRecorded: true,
        }
      : await this.performCheckIn(member, session.gymId, 'kiosk', undefined, session.branchId);

    await this.audit.log({
      action: 'MEMBER_SELF_REGISTERED',
      entity: 'Member',
      entityId: member.id,
      newValue: { memberCode: member.memberCode, firstName: member.firstName, lastName: member.lastName },
      gymId: session.gymId,
      ipAddress,
      userAgent,
    });

    return {
      member: this.memberSummary(member),
      attendance,
      membershipStatus: member.currentMembership?.status ?? null,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Step 5 — check in / check out (existing members)                    */
  /* ------------------------------------------------------------------ */

  /** Per-day attendance: no record today → check in; open record → already
   *  in; completed → "Attendance already completed for today." */
  /** Enforces the branch geofence (when one is configured) for kiosk
   *  check-in/out — this was previously only checked on the in-app QR flow
   *  (attendance.service.ts), leaving the kiosk/self check-in flow open to
   *  remote/spoofed check-ins. Silently passes if the branch has no
   *  geofence configured, matching the existing in-app behavior. */
  private async assertWithinGeofence(gymId: string, branchId: string | null | undefined, latitude?: number, longitude?: number) {
    if (!branchId) return;
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, gymId },
      select: { latitude: true, longitude: true, geofenceRadiusMeters: true },
    });
    if (!branch?.geofenceRadiusMeters || branch.latitude == null || branch.longitude == null) return;

    if (latitude == null || longitude == null) {
      throw new BadRequestException('Location access is required to check in at this branch — please enable GPS and try again.');
    }
    const distance = distanceMeters(latitude, longitude, branch.latitude, branch.longitude);
    if (distance > branch.geofenceRadiusMeters) {
      throw new BadRequestException(
        `You appear to be ${Math.round(distance)}m from the branch (allowed: ${branch.geofenceRadiusMeters}m) — move closer and try again.`,
      );
    }
  }

  async checkIn(dto: CheckinActionDto) {
    const session = await this.verifyToken<SessionPayload>(dto.sessionToken, 'checkin-session');
    await this.assertGymActive(session.gymId);
    await this.assertWithinGeofence(session.gymId, session.branchId, dto.latitude, dto.longitude);
    const member = await this.findMemberByMobile(session.gymId, session.mobile);
    if (!member) throw new NotFoundException('Member not found — please register first');

    const state = await this.todayState(session.gymId, member.id);
    if (state.checkedIn && state.checkOutAt) {
      throw new BadRequestException('Attendance already completed for today.');
    }
    if (state.checkedIn && !state.checkOutAt) {
      throw new BadRequestException('Already checked in today — scan again to check out.');
    }

    const attendance = await this.performCheckIn(member, session.gymId, dto.deviceType ?? 'kiosk', dto.location, session.branchId);
    await this.audit.log({
      action: 'CHECK_IN',
      entity: 'Attendance',
      entityId: attendance.id,
      newValue: { memberId: member.id, source: 'kiosk', deviceType: dto.deviceType, location: dto.location },
      gymId: session.gymId,
    });
    return attendance;
  }

  async checkOut(dto: CheckinActionDto) {
    const session = await this.verifyToken<SessionPayload>(dto.sessionToken, 'checkin-session');
    await this.assertGymActive(session.gymId);
    await this.assertWithinGeofence(session.gymId, session.branchId, dto.latitude, dto.longitude);
    const member = await this.findMemberByMobile(session.gymId, session.mobile);
    if (!member) throw new NotFoundException('Member not found — please register first');

    const state = await this.todayState(session.gymId, member.id);
    if (!state.checkedIn || !state.recordId) {
      throw new BadRequestException('No active check-in found for today.');
    }
    if (state.checkOutAt) {
      throw new BadRequestException('Attendance already completed for today.');
    }

    return this.attendanceCore.closeOpenSession({
      member,
      gymId: session.gymId,
      branchId: session.branchId ?? member.branchId,
      source: 'KIOSK' as any,
      performedBy: null,
      deviceType: dto.deviceType,
      location: dto.location,
    });
  }

  /* ------------------------------------------------------------------ */
  /* Helpers                                                             */
  /* ------------------------------------------------------------------ */

  private async signToken<T>(payload: T, ttlSeconds: number): Promise<string> {
    return this.jwt.signAsync(payload as object, {
      secret: this.config.get('app.jwtSecret'),
      expiresIn: ttlSeconds,
    });
  }

  private async verifyToken<T extends { purpose: string }>(token: string, purpose: string): Promise<T> {
    try {
      const payload = await this.jwt.verifyAsync<T>(token, {
        secret: this.config.get('app.jwtSecret'),
      });
      if (payload.purpose !== purpose) throw new Error('wrong purpose');
      return payload;
    } catch {
      throw new UnauthorizedException('Session expired — please scan the QR again.');
    }
  }

  private async assertGymActive(gymId: string) {
    const gym = await this.prisma.gym.findFirst({
      where: { id: gymId, status: 'ACTIVE', deletedAt: null },
      select: { id: true },
    });
    if (!gym) throw new ForbiddenException('Gym is not active — check-in unavailable.');
  }

  private async findMemberByMobile(gymId: string, mobile: string) {
    return this.prisma.member.findFirst({
      where: { gymId, mobile, deletedAt: null },
      include: { currentMembership: true, batch: true },
    });
  }

  private memberSummary(member: any) {
    return {
      id: member.id,
      memberCode: member.memberCode,
      firstName: member.firstName,
      lastName: member.lastName,
      photo: member.photo,
      email: member.email,
      gender: member.gender,
      membership: member.currentMembership
        ? {
            status: member.currentMembership.status,
            planName: member.currentMembership.planName,
            endDate: member.currentMembership.endDate,
          }
        : null,
    };
  }

  /** Today's check-in state for a member: whether they've checked in today,
   *  the open record id, and the check-out time (if already completed). */
  private async todayState(gymId: string, memberId: string) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const record = await this.prisma.attendance.findFirst({
      where: { gymId, memberId, checkInAt: { gte: start, lt: end } },
      orderBy: { checkInAt: 'desc' },
    });
    return {
      recordId: record?.id ?? null,
      checkedIn: record?.checkInAt ?? null,
      checkOutAt: record?.checkOutAt ?? null,
    };
  }

  /** Thin wrapper over the shared atomic core — kiosk source, no authenticated performer. */
  private async performCheckIn(member: any, gymId: string, deviceType: string, location?: string, branchId?: string) {
    return this.attendanceCore.recordScan({
      member,
      gymId,
      branchId: branchId ?? member.branchId,
      source: 'KIOSK' as any,
      performedBy: null,
      deviceType,
      location,
    });
  }

  /** Creates a member profile + PENDING (pending-approval) membership in a transaction. */
  private async createMemberWithPendingMembership(
    gymId: string,
    dto: RegisterMemberDto,
    mobile: string,
  ) {
    const memberCode = await this.generateMemberCode(gymId);
    const memberId = randomUUID();
    const qrCodeData = this.encryption.generateQRCodeData(memberId, gymId);
    const qrCode = this.encryption.hash(qrCodeData);

    const start = new Date();
    const end = new Date(start);
    end.setDate(end.getDate() + 14);

    return this.prisma.$transaction(async (tx) => {
      const member = await tx.member.create({
        data: {
          id: memberId,
          memberCode,
          photo: dto.photo,
          firstName: dto.firstName,
          lastName: dto.lastName,
          gender: dto.gender,
          dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
          mobile,
          email: dto.email,
          address: dto.address,
          city: dto.city,
          state: dto.state,
          pincode: dto.pincode,
          qrCode,
          qrCodeData,
          referralCode: `${memberCode}-REF`,
          status: UserStatus.ACTIVE,
          gymId,
        },
      });

      const membership = await tx.membership.create({
        data: {
          memberId: member.id,
          plan: MembershipPlan.TRIAL,
          planName: 'Pending Approval',
          duration: 14,
          startDate: start,
          endDate: end,
          baseAmount: new Decimal(0),
          discountAmount: new Decimal(0),
          taxAmount: new Decimal(0),
          totalAmount: new Decimal(0),
          status: MembershipStatus.PENDING,
          gymId,
        },
      });

      await tx.member.update({
        where: { id: member.id },
        data: { currentMembershipId: membership.id },
      });

      const created = await tx.member.findUnique({
        where: { id: member.id },
        include: { currentMembership: true, batch: true },
      });
      if (!created) throw new Error('Member could not be created');
      return created;
    });
  }

  /** memberCode format: GYM-prefix + zero-padded sequence, e.g. MOS-000001 */
  private async generateMemberCode(gymId: string): Promise<string> {
    const gym = await this.prisma.gym.findUnique({ where: { id: gymId }, select: { slug: true } });
    const prefix = (gym?.slug || 'MOS').slice(0, 4).toUpperCase();
    const count = await this.prisma.member.count({ where: { gymId } });
    const sequence = (count + 1).toString().padStart(6, '0');
    const candidate = `${prefix}-${sequence}`;
    const clash = await this.prisma.member.findUnique({ where: { memberCode: candidate } });
    return clash ? `${prefix}-${Date.now().toString().slice(-6)}` : candidate;
  }
}
