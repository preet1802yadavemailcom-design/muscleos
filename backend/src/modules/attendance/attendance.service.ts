import { randomUUID } from 'crypto';

import { CurrentUserPayload } from '@common/decorators/current-user.decorator';
import { distanceMeters } from '@common/utils/geo.util';
import { PrismaService } from '@database/prisma.service';
import { QrService } from '@modules/qr/qr.service';
import { Injectable, BadRequestException, NotFoundException, ForbiddenException, UnauthorizedException, Optional } from '@nestjs/common';
import { MembershipPlan, MembershipStatus, UserStatus, UserRole, Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AccessScopeService } from '@shared/services/access-scope.service';
import { AuditService } from '@shared/services/audit.service';
import { EncryptionService } from '@shared/services/encryption.service';
import { SequenceService } from '@shared/services/sequence.service';

import {
  DEFAULT_TIMEZONE,
  getGymStartOfDay,
  getGymEndOfDay,
  getGymStartOfWeek,
  getGymStartOfMonth,
  parseGymTimeToDate,
} from '@common/utils/timezone.util';

import { AttendanceCoreService } from './attendance-core.service';
import { ScanQrDto, QueryAttendanceDto } from './dto';

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly encryption: EncryptionService,
    private readonly core: AttendanceCoreService,
    private readonly qr: QrService,
    private readonly sequence: SequenceService,
    @Optional() private readonly accessScope?: AccessScopeService,
  ) {}

  /**
   * Core QR scan flow:
   *  - A permanent BRANCH QR (opaque token, printed on the wall) lets the
   *    logged-in user self check in/out at that location.
   *  - A MEMBER QR keeps the front-desk "scan a member's card" flow working
   *    (still the legacy encrypted format — a member's personal card, not
   *    the wall poster, so it isn't part of the QrService token system).
   * Flow: resolve branch/gym → resolve member → membership/batch checks →
   * geofence (if configured) → atomic check-in/out via AttendanceCoreService.
   */
  async scan(scannerGymId: string, dto: ScanQrDto, user: CurrentUserPayload) {
    let gymId: string;
    let branchId: string | undefined;
    let geofence: { latitude: number | null; longitude: number | null; radius: number | null } | undefined;
    let decodedMemberId: string | undefined;

    if (!dto.qrCodeData.includes(':')) {
      // New opaque branch token — see qr.service.ts.
      const resolved = await this.qr.resolveToken(dto.qrCodeData);
      gymId = resolved.gym.id;
      branchId = resolved.branch.id;
      geofence = {
        latitude: resolved.branch.latitude,
        longitude: resolved.branch.longitude,
        radius: resolved.branch.geofenceRadiusMeters,
      };
    } else {
      // Only the member-card format survives here now — the old static
      // "gym" QR (self check-in with no branch/geofence, and a
      // "regenerate" that didn't actually invalidate anything) has been
      // fully retired, not just deprecated: this branch now REJECTS
      // kind:'gym' rather than silently honoring it, so an old printed
      // poster genuinely stops working instead of quietly continuing to
      // decode forever.
      let decoded: { kind: 'gym' | 'member'; gymId: string; memberId?: string; timestamp: number };
      try {
        decoded = this.encryption.decodeQRCodeData(dto.qrCodeData);
      } catch {
        throw new BadRequestException('Invalid or corrupted QR code');
      }
      if (decoded.kind !== 'member') {
        throw new BadRequestException('This QR code is no longer valid — please use the current branch QR poster.');
      }
      gymId = decoded.gymId;
      decodedMemberId = decoded.memberId;
    }

    // 1. Gym match — a QR only works at its own gym.
    if (gymId !== scannerGymId) {
      throw new ForbiddenException('This QR code does not belong to this gym');
    }

    // 2. Resolve the member being checked in/out.
    let member;
    const isOtherDevice = decodedMemberId !== undefined;
    if (isOtherDevice && user.role === UserRole.MEMBER) {
      throw new ForbiddenException('Members may only self check-in by scanning branch QR codes.');
    }
    if (decodedMemberId === undefined && branchId !== undefined) {
      // Self check-in via branch QR: the person scanning IS the member.
      member = await this.resolveMemberForUser(scannerGymId, user);
    } else if (decodedMemberId === undefined) {
      // Legacy self check-in (old gym-wide QR, no branch).
      member = await this.resolveMemberForUser(scannerGymId, user);
    } else {
      // Front-desk flow: scan the member's own QR.
      // Must match qrCodeData to ensure regenerated or revoked cards are rejected immediately.
      member = await this.prisma.member.findFirst({
        where: { id: decodedMemberId, gymId: scannerGymId, qrCodeData: dto.qrCodeData, deletedAt: null },
        include: { currentMembership: true, batch: true },
      });
      if (!member) throw new NotFoundException('Member not found or QR code has been revoked/regenerated');
    }

    // TS can't see both branches guarantee a member, so narrow explicitly.
    if (!member) throw new NotFoundException('Member not found');

    if (isOtherDevice && user && this.accessScope?.isBranchScoped(user)) {
      this.accessScope.assertBranchAccess(user, member.branchId);
    }

    // 3. Member must be active.
    if (member.status === UserStatus.PENDING) {
      throw new ForbiddenException('Registration is pending owner approval.');
    }
    if (member.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException(`Member is ${member.status.toLowerCase()} — attendance blocked`);
    }

    // 3.5 OTHER_DEVICE identity confirmation gate: never mark attendance
    // until the scanning device explicitly resubmits with confirmed:true.
    if (isOtherDevice && !dto.confirmed) {
      return {
        requiresConfirmation: true,
        member: {
          id: member.id,
          name: `${member.firstName} ${member.lastName}`,
          memberCode: member.memberCode,
          photo: member.photo ?? null,
        },
      };
    }

    if (!member.batchId) {
      throw new ForbiddenException('No batch assigned — gym owner must assign a batch before attendance is allowed.');
    }

    // 4. Membership validity - shared with the manual (no-QR) flow below.
    await this.ensureMembershipValid(member, scannerGymId);

    // 4.5 Geofence — an ADDITIONAL signal, not the sole security control (per
    // spec: GPS can be spoofed, so this narrows accidental/opportunistic
    // remote check-ins rather than being treated as strong identity proof).
    // Only enforced when the branch has actually configured one.
    if (geofence?.radius && geofence.latitude != null && geofence.longitude != null) {
      if (dto.latitude == null || dto.longitude == null) {
        throw new ForbiddenException('Location is required to check in at this branch — please enable location access.');
      }
      const distance = distanceMeters(dto.latitude, dto.longitude, geofence.latitude, geofence.longitude);
      if (distance > geofence.radius) {
        throw new ForbiddenException(
          `You appear to be ${Math.round(distance)}m from the branch (allowed: ${geofence.radius}m) — move closer and try again.`,
        );
      }
    }

    // 5/6. Duplicate-scan guard + check-in-vs-check-out decision are both
    // handled atomically by AttendanceCoreService (DB partial-unique-index
    // backed) — see attendance-core.service.ts for why this can't safely be
    // a separate "read state, then decide" step here.
    return this.core.recordScan({
      member,
      gymId: scannerGymId,
      branchId: branchId ?? user.branchId ?? member.branchId,
      source: (isOtherDevice ? 'OTHER_DEVICE' : 'SELF') as any,
      performedBy: isOtherDevice ? user.userId : null,
      deviceType: dto.deviceType,
      location: dto.location,
      latitude: dto.latitude,
      longitude: dto.longitude,
    });
  }

    /**
   * MANUAL mode - the third of the spec's three attendance modes. No QR, no
   * member phone needed at all: staff search for the member by name/code/
   * mobile (existing GET /members?search=), see their identity, confirm,
   * and check them in/out directly. Always recorded under the authorized
   * staff member's own identity (performedBy), never anonymously.
   */
  async manualCheckIn(gymId: string, memberId: string, staffUser: CurrentUserPayload) {
    const member = await this.prisma.member.findFirst({
      where: { id: memberId, gymId, deletedAt: null },
      include: { currentMembership: true, batch: true },
    });
    if (!member) throw new NotFoundException('Member not found');

    if (this.accessScope?.isBranchScoped(staffUser)) {
      this.accessScope.assertBranchAccess(staffUser, member.branchId);
    }

    if (member.status === UserStatus.PENDING) {
      throw new ForbiddenException('Registration is pending owner approval.');
    }
    if (member.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException(`Member is ${member.status.toLowerCase()} - attendance blocked`);
    }
    if (!member.batchId) {
      throw new ForbiddenException('No batch assigned — gym owner must assign a batch before attendance is allowed.');
    }

    await this.ensureMembershipValid(member, gymId);

    return this.core.recordScan({
      member,
      gymId,
      branchId: staffUser.branchId ?? member.branchId ?? undefined,
      source: 'MANUAL' as any,
      performedBy: staffUser.userId,
      deviceType: 'reception',
    });
  }

  /** Shared membership-validity gate for both the QR scan flow and the
   *  MANUAL (no-QR) flow. */
  private async ensureMembershipValid(member: any, gymId: string) {
    let membership = member.currentMembership;
    if (!membership) {
      membership = await this.grantTrialMembership(member.id, gymId);
      member.currentMembership = membership;
    }
    if (membership.endDate < new Date()) {
      throw new ForbiddenException('Membership has expired - please renew to check in');
    }
    if (membership.status === MembershipStatus.FROZEN) {
      throw new ForbiddenException('Membership is currently frozen');
    }
    if (membership.status !== MembershipStatus.ACTIVE) {
      throw new ForbiddenException(`Membership is ${membership.status.toLowerCase()} - attendance blocked`);
    }
    return membership;
  }

/**
   * Finds the Member profile belonging to a logged-in user (by email/phone +
   * gym), creating one on first scan so self check-in works end to end.
   * A brand-new profile also gets a 14-day trial membership (mirroring the
   * gym's TRIAL plan) so the first check-in isn't blocked.
   */
  private async resolveMemberForUser(gymId: string, user: CurrentUserPayload) {
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.userId },
      select: { id: true, email: true, firstName: true, lastName: true, phone: true, gymId: true },
    });
    if (!dbUser) throw new UnauthorizedException('User not found');

    // Match an existing member profile by email or phone so we never create a
    // duplicate — the Members page may have registered them with either.
    let member = await this.prisma.member.findFirst({
      where: {
        gymId,
        deletedAt: null,
        OR: [
          ...(dbUser.email ? [{ email: dbUser.email }] : []),
          ...(dbUser.phone ? [{ mobile: dbUser.phone }] : []),
        ],
      },
      include: { currentMembership: true, batch: true },
    });
    if (member) return member;

    // Check if gym allows trial membership self-provisioning via QR scan
    const setting = await this.prisma.gymSetting.findUnique({
      where: { gymId_category_key: { gymId, category: 'attendance', key: 'allow_trial_on_scan' } },
    });
    const allowTrial = setting ? setting.value === 'true' || setting.value === '1' : false;
    if (!allowTrial) {
      throw new ForbiddenException('No active membership found for this gym. Please contact reception to activate your membership.');
    }

    const memberCode = await this.generateMemberCode(gymId);
    const memberId = randomUUID();
    const qrCodeData = this.encryption.generateQRCodeData(memberId, gymId);
    const qrCode = this.encryption.hash(qrCodeData);

    const created = await this.prisma.member.create({
      data: {
        id: memberId,
        memberCode,
        firstName: dbUser.firstName,
        lastName: dbUser.lastName,
        email: dbUser.email,
        mobile: dbUser.phone ?? '',
        gymId,
        qrCode,
        qrCodeData,
        referralCode: `${memberCode}-REF`,
        status: UserStatus.ACTIVE,
      },
    });

    await this.grantTrialMembership(created.id, gymId);

    member = await this.prisma.member.findUnique({
      where: { id: created.id },
      include: { currentMembership: true, batch: true },
    });
    if (!member) throw new NotFoundException('Member could not be created');

    await this.audit.log({
      action: 'CREATE',
      entity: 'Member',
      entityId: member.id,
      newValue: {
        memberCode: member.memberCode,
        firstName: member.firstName,
        lastName: member.lastName,
        trialMembership: '14 days',
      },
      userId: user.userId,
      gymId,
    });

    return member;
  }

  /** Creates a 14-day active trial membership and links it as the member's current membership. */
  private async grantTrialMembership(memberId: string, gymId: string) {
    const trialStart = new Date();
    const trialEnd = new Date(trialStart.getTime() + 14 * 24 * 60 * 60 * 1000);

    return this.prisma.$transaction(async (tx) => {
      const trial = await tx.membership.create({
        data: {
          memberId,
          plan: MembershipPlan.TRIAL,
          planName: '14-Day Trial',
          duration: 14,
          startDate: trialStart,
          endDate: trialEnd,
          baseAmount: new Decimal(0),
          discountAmount: new Decimal(0),
          taxAmount: new Decimal(0),
          totalAmount: new Decimal(0),
          status: MembershipStatus.ACTIVE,
          gymId,
        },
      });

      await tx.member.update({
        where: { id: memberId },
        data: { currentMembershipId: trial.id },
      });

      return trial;
    });
  }

  /** memberCode format: GYM-prefix + zero-padded sequence, e.g. MOS-000001.
   *  Uses the atomic SequenceService instead of count()+1 — two
   *  simultaneous trial-signups can never be handed the same code. */
  private async generateMemberCode(gymId: string): Promise<string> {
    const gym = await this.prisma.gym.findUnique({ where: { id: gymId }, select: { slug: true } });
    const prefix = (gym?.slug || 'MOS').slice(0, 4).toUpperCase();
    const next = await this.sequence.next(gymId, 'MEMBER_CODE');
    const sequence = next.toString().padStart(6, '0');
    const candidate = `${prefix}-${sequence}`;
    const clash = await this.prisma.member.findUnique({ where: { memberCode: candidate } });
    return clash ? `${prefix}-${Date.now().toString().slice(-6)}` : candidate;
  }

  /** A member's own recent attendance (self-service page, supporting month/year filter & pagination). */
  async myHistory(
    gymId: string,
    user: CurrentUserPayload,
    query?: { month?: number; year?: number; page?: number; limit?: number },
  ) {
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.userId },
      select: { email: true, phone: true },
    });
    const member = await this.prisma.member.findFirst({
      where: {
        gymId,
        deletedAt: null,
        OR: [
          ...(dbUser?.email ? [{ email: dbUser.email }] : []),
          ...(dbUser?.phone ? [{ mobile: dbUser.phone }] : []),
        ],
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        memberCode: true,
        photo: true,
        batch: { select: { id: true, name: true, startTime: true, endTime: true } },
        branch: { select: { id: true, name: true } },
      },
    });
    if (!member) return { member: null, data: [], meta: { total: 0, page: 1, limit: 30, totalPages: 0 } };

    const page = Math.max(1, query?.page ?? 1);
    const limit = Math.min(100, Math.max(1, query?.limit ?? 30));
    const skip = (page - 1) * limit;

    const where: any = { memberId: member.id, gymId };
    if (query?.month && query?.year) {
      const start = new Date(query.year, query.month - 1, 1);
      const end = new Date(query.year, query.month, 1);
      where.checkInAt = { gte: start, lt: end };
    }

    const [data, total] = await Promise.all([
      this.prisma.attendance.findMany({
        where,
        orderBy: { checkInAt: 'desc' },
        skip,
        take: limit,
        include: {
          batch: { select: { id: true, name: true } },
          branch: { select: { id: true, name: true } },
        },
      }),
      this.prisma.attendance.count({ where }),
    ]);

    return {
      member,
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getGymTimezone(gymId: string): Promise<string> {
    const setting = await this.prisma.gymSetting.findUnique({
      where: { gymId_category_key: { gymId, category: 'business', key: 'timezone' } },
    });
    return setting?.value || DEFAULT_TIMEZONE;
  }

  async findAll(gymId: string, query: QueryAttendanceDto, user?: CurrentUserPayload) {
    const {
      page = 1,
      limit = 20,
      memberId,
      batchId,
      fromDate,
      toDate,
      search,
      timeFrom,
      timeTo,
      status,
      period,
    } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.AttendanceWhereInput = { gymId };
    if (user && this.accessScope?.isBranchScoped(user)) {
      const branchId = this.accessScope.getBranchId(user);
      if (branchId) where.branchId = branchId;
    }
    if (memberId) where.memberId = memberId;
    if (batchId) where.batchId = batchId;
    if (status) where.status = status as any;

    const tz = await this.getGymTimezone(gymId);

    // Period / Date Range resolution in gym timezone
    if (period === 'DAY' && fromDate) {
      const d = new Date(fromDate);
      where.checkInAt = {
        gte: getGymStartOfDay(d, tz),
        lte: getGymEndOfDay(d, tz),
      };
    } else if (period === 'WEEK' && fromDate) {
      const d = new Date(fromDate);
      const start = getGymStartOfWeek(d, tz);
      const end = getGymEndOfDay(new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000), tz);
      where.checkInAt = { gte: start, lte: end };
    } else if (fromDate || toDate) {
      const start = fromDate ? getGymStartOfDay(new Date(fromDate), tz) : undefined;
      const end = toDate ? getGymEndOfDay(new Date(toDate), tz) : undefined;
      where.checkInAt = {
        ...(start ? { gte: start } : {}),
        ...(end ? { lte: end } : {}),
      };
    }

    // Time-of-day filter (e.g. 06:00 to 09:00)
    if (timeFrom && timeTo) {
      const baseDate = fromDate ? new Date(fromDate) : new Date();
      const timeStart = parseGymTimeToDate(timeFrom, baseDate, tz);
      const timeEnd = parseGymTimeToDate(timeTo, baseDate, tz);
      where.checkInAt = {
        ...(where.checkInAt as any ?? {}),
        gte: timeStart,
        lte: timeEnd,
      };
    }

    // Member search filter (by name, member code, phone, or email)
    if (search && search.trim()) {
      const s = search.trim();
      where.member = {
        OR: [
          { firstName: { contains: s, mode: 'insensitive' } },
          { lastName: { contains: s, mode: 'insensitive' } },
          { memberCode: { contains: s, mode: 'insensitive' } },
          { mobile: { contains: s } },
          { email: { contains: s, mode: 'insensitive' } },
        ],
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.attendance.findMany({
        where,
        skip,
        take: limit,
        orderBy: { checkInAt: 'desc' },
        include: {
          member: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              memberCode: true,
              mobile: true,
              email: true,
              photo: true,
            },
          },
          batch: { select: { id: true, name: true, startTime: true, endTime: true } },
          branch: { select: { id: true, name: true } },
        },
      }),
      this.prisma.attendance.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1,
      },
    };
  }

  /** Paginated historical attendance for a specific member profile. */
  async getMemberAttendanceHistory(
    gymId: string,
    memberId: string,
    query: { page?: number; limit?: number },
    user?: CurrentUserPayload,
  ) {
    const member = await this.prisma.member.findUnique({
      where: { id: memberId, gymId, deletedAt: null },
      select: { id: true, branchId: true },
    });
    if (!member) throw new NotFoundException('Member not found');
    if (user && this.accessScope?.isBranchScoped(user)) {
      this.accessScope.assertBranchAccess(user, member.branchId);
    }

    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const skip = (page - 1) * limit;

    const where: Prisma.AttendanceWhereInput = { memberId, gymId };

    const [data, total] = await Promise.all([
      this.prisma.attendance.findMany({
        where,
        skip,
        take: limit,
        orderBy: { checkInAt: 'desc' },
        include: {
          batch: { select: { id: true, name: true, startTime: true, endTime: true } },
          branch: { select: { id: true, name: true } },
        },
      }),
      this.prisma.attendance.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1,
      },
    };
  }

  /** Summary attendance metrics for Member 360 profile. */
  async getMemberAttendanceStats(gymId: string, memberId: string, user?: CurrentUserPayload) {
    const member = await this.prisma.member.findUnique({
      where: { id: memberId, gymId, deletedAt: null },
      select: { id: true, branchId: true, currentStreak: true, longestStreak: true },
    });
    if (!member) throw new NotFoundException('Member not found');
    if (user && this.accessScope?.isBranchScoped(user)) {
      this.accessScope.assertBranchAccess(user, member.branchId);
    }

    const tz = await this.getGymTimezone(gymId);
    const now = new Date();
    const startOfWeek = getGymStartOfWeek(now, tz);
    const startOfMonth = getGymStartOfMonth(now, tz);

    const [totalVisits, thisWeek, thisMonth, lastRecord] = await Promise.all([
      this.prisma.attendance.count({ where: { memberId, gymId } }),
      this.prisma.attendance.count({ where: { memberId, gymId, checkInAt: { gte: startOfWeek } } }),
      this.prisma.attendance.count({ where: { memberId, gymId, checkInAt: { gte: startOfMonth } } }),
      this.prisma.attendance.findFirst({
        where: { memberId, gymId },
        orderBy: { checkInAt: 'desc' },
        select: { checkInAt: true, checkOutAt: true },
      }),
    ]);

    return {
      totalVisits,
      thisWeek,
      thisMonth,
      currentStreak: member.currentStreak ?? 0,
      longestStreak: member.longestStreak ?? 0,
      lastCheckIn: lastRecord?.checkInAt ?? null,
    };
  }

  /** A member's own attendance calendar (for the member-facing app/portal). */
  async memberHistory(memberId: string, gymId: string, month?: number, year?: number, user?: CurrentUserPayload) {
    if (user && this.accessScope?.isBranchScoped(user)) {
      const member = await this.prisma.member.findUnique({ where: { id: memberId }, select: { branchId: true } });
      if (member) {
        this.accessScope.assertBranchAccess(user, member.branchId);
      }
    }
    const now = new Date();
    const y = year ?? now.getFullYear();
    const m = month ?? now.getMonth() + 1;
    const start = new Date(y, m - 1, 1);
    const end = new Date(y, m, 1);

    return this.prisma.attendance.findMany({
      where: { memberId, gymId, checkInAt: { gte: start, lt: end } },
      orderBy: { checkInAt: 'asc' },
    });
  }

  /** Live "who's in the gym right now" dashboard feed. */
  async liveFeed(gymId: string, user?: CurrentUserPayload) {
    const tz = await this.getGymTimezone(gymId);
    const now = new Date();
    const startOfDay = getGymStartOfDay(now, tz);
    const endOfDay = getGymEndOfDay(now, tz);

    const where: Prisma.AttendanceWhereInput = {
      gymId,
      checkInAt: { gte: startOfDay, lte: endOfDay },
      checkOutAt: null,
    };
    if (user && this.accessScope?.isBranchScoped(user)) {
      const branchId = this.accessScope.getBranchId(user);
      if (branchId) where.branchId = branchId;
    }
    return this.prisma.attendance.findMany({
      where,
      orderBy: { checkInAt: 'desc' },
      take: 50,
      include: {
        member: {
          select: { id: true, firstName: true, lastName: true, memberCode: true, photo: true },
        },
        batch: { select: { id: true, name: true } },
      },
    });
  }

  /** Flags sessions still open past closing time — feeds the "missed checkout" report. */
  async missedCheckouts(gymId: string, hoursThreshold = 4, user?: CurrentUserPayload) {
    const cutoff = new Date(Date.now() - hoursThreshold * 60 * 60 * 1000);
    const where: Prisma.AttendanceWhereInput = { gymId, checkOutAt: null, checkInAt: { lt: cutoff } };
    if (user && this.accessScope?.isBranchScoped(user)) {
      const branchId = this.accessScope.getBranchId(user);
      if (branchId) where.branchId = branchId;
    }
    return this.prisma.attendance.findMany({
      where,
      include: { member: { select: { id: true, firstName: true, lastName: true, mobile: true } } },
    });
  }
}
