import { randomUUID } from 'crypto';

import { PrismaService } from '@database/prisma.service';
import { Decimal } from '@prisma/client/runtime/library';
import { Injectable, BadRequestException, NotFoundException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { MembershipPlan, MembershipStatus, UserStatus, Prisma } from '@prisma/client';
import { AuditService } from '@shared/services/audit.service';
import { EncryptionService } from '@shared/services/encryption.service';
import { CurrentUserPayload } from '@common/decorators/current-user.decorator';
import { distanceMeters } from '@common/utils/geo.util';
import { QrService } from '@modules/qr/qr.service';

import { ScanQrDto, QueryAttendanceDto } from './dto';
import { AttendanceCoreService } from './attendance-core.service';

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly encryption: EncryptionService,
    private readonly core: AttendanceCoreService,
    private readonly qr: QrService,
  ) {}

  /**
   * Core QR scan flow:
   *  - A permanent BRANCH QR (opaque token, printed on the wall) lets the
   *    logged-in user self check in/out at that location.
   *  - A MEMBER QR keeps the front-desk "scan a member's card" flow working
   *    (still the legacy encrypted format �?" a member's personal card, not
   *    the wall poster, so it isn't part of the QrService token system).
   * Flow: resolve branch/gym �?' resolve member �?' membership/batch checks �?'
   * geofence (if configured) �?' atomic check-in/out via AttendanceCoreService.
   */
  async scan(scannerGymId: string, dto: ScanQrDto, user: CurrentUserPayload) {
    let gymId: string;
    let branchId: string | undefined;
    let geofence: { latitude: number | null; longitude: number | null; radius: number | null } | undefined;
    let decodedMemberId: string | undefined;

    if (!dto.qrCodeData.includes(':')) {
      // New opaque branch token �?" see qr.service.ts.
      const resolved = await this.qr.resolveToken(dto.qrCodeData);
      gymId = resolved.gym.id;
      branchId = resolved.branch.id;
      geofence = {
        latitude: resolved.branch.latitude,
        longitude: resolved.branch.longitude,
        radius: resolved.branch.geofenceRadiusMeters,
      };
    } else {
      // Only the member-card format survives here now �?" the old static
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
        throw new BadRequestException('This QR code is no longer valid �?" please use the current branch QR poster.');
      }
      gymId = decoded.gymId;
      decodedMemberId = decoded.memberId;
    }

    // 1. Gym match �?" a QR only works at its own gym.
    if (gymId !== scannerGymId) {
      throw new ForbiddenException('This QR code does not belong to this gym');
    }

    // 2. Resolve the member being checked in/out.
    let member;
    const isOtherDevice = decodedMemberId !== undefined;
    if (decodedMemberId === undefined && branchId !== undefined) {
      // Self check-in via branch QR: the person scanning IS the member.
      member = await this.resolveMemberForUser(scannerGymId, user);
    } else if (decodedMemberId === undefined) {
      // Legacy self check-in (old gym-wide QR, no branch).
      member = await this.resolveMemberForUser(scannerGymId, user);
    } else {
      // Front-desk flow: scan the member's own QR.
      member = await this.prisma.member.findFirst({
        where: { id: decodedMemberId, gymId: scannerGymId, deletedAt: null },
        include: { currentMembership: true, batch: true },
      });
      if (!member) throw new NotFoundException('Member not found');
    }

    // TS can't see both branches guarantee a member, so narrow explicitly.
    if (!member) throw new NotFoundException('Member not found');

    // 3. Member must be active.
    if (member.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException(`Member is ${member.status.toLowerCase()} �?" attendance blocked`);
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

    // 4. Membership validity.
    //    Members added from the Members page have no membership record yet �?"
    //    grant a 14-day trial on their first scan so check-in actually works
    //    instead of silently failing. Only block when a membership exists but
    //    is expired, frozen, or otherwise not active.
    let membership = member.currentMembership;
    if (!membership) {
      membership = await this.grantTrialMembership(member.id, scannerGymId);
      member.currentMembership = membership;
    }
    if (membership.endDate < new Date()) {
      throw new ForbiddenException('Membership has expired �?" please renew to check in');
    }
    if (membership.status === MembershipStatus.FROZEN) {
      throw new ForbiddenException('Membership is currently frozen');
    }
    if (membership.status !== MembershipStatus.ACTIVE) {
      throw new ForbiddenException(`Membership is ${membership.status.toLowerCase()} �?" attendance blocked`);
    }

    // 4.5 Geofence �?" an ADDITIONAL signal, not the sole security control (per
    // spec: GPS can be spoofed, so this narrows accidental/opportunistic
    // remote check-ins rather than being treated as strong identity proof).
    // Only enforced when the branch has actually configured one.
    if (geofence?.radius && geofence.latitude != null && geofence.longitude != null) {
      if (dto.latitude == null || dto.longitude == null) {
        throw new ForbiddenException('Location is required to check in at this branch �?" please enable location access.');
      }
      const distance = distanceMeters(dto.latitude, dto.longitude, geofence.latitude, geofence.longitude);
      if (distance > geofence.radius) {
        throw new ForbiddenException(
          `You appear to be ${Math.round(distance)}m from the branch (allowed: ${geofence.radius}m) �?" move closer and try again.`,
        );
      }
    }

    // 5/6. Duplicate-scan guard + check-in-vs-check-out decision are both
    // handled atomically by AttendanceCoreService (DB partial-unique-index
    // backed) �?" see attendance-core.service.ts for why this can't safely be
    // a separate "read state, then decide" step here.
    return this.core.recordScan({
      member,
      gymId: scannerGymId,
      branchId: branchId ?? member.branchId,
      source: (isOtherDevice ? 'OTHER_DEVICE' : 'SELF') as any,
      performedBy: isOtherDevice ? user.userId : null,
      deviceType: dto.deviceType,
      location: dto.location,
      latitude: dto.latitude,
      longitude: dto.longitude,
    });
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
    // duplicate �?" the Members page may have registered them with either.
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

  /** A member's own recent attendance (self-service page). */
  async myHistory(gymId: string, user: CurrentUserPayload, page = 1, limit = 30) {
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
      select: { id: true, firstName: true, lastName: true, memberCode: true, photo: true, batch: { select: { id: true, name: true } } },
    });
    if (!member) return { member: null, data: [] };

    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const safePage = Math.max(page, 1);
    const where = { memberId: member.id, gymId };
    const [data, total] = await Promise.all([
      this.prisma.attendance.findMany({
        where,
        orderBy: { checkInAt: 'desc' },
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
      }),
      this.prisma.attendance.count({ where }),
    ]);
    return { member, data, total, page: safePage, limit: safeLimit };
  }

  async findAll(gymId: string, query: QueryAttendanceDto) {
    const { page = 1, limit = 20, memberId, batchId, fromDate, toDate } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.AttendanceWhereInput = { gymId };
    if (memberId) where.memberId = memberId;
    if (batchId) where.batchId = batchId;
    if (fromDate || toDate) {
      where.checkInAt = {
        ...(fromDate ? { gte: new Date(fromDate) } : {}),
        ...(toDate ? { lte: new Date(toDate) } : {}),
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.attendance.findMany({
        where,
        skip,
        take: limit,
        orderBy: { checkInAt: 'desc' },
        include: {
          member: { select: { id: true, firstName: true, lastName: true, memberCode: true, photo: true } },
          batch: { select: { id: true, name: true } },
        },
      }),
      this.prisma.attendance.count({ where }),
    ]);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /** A member's own attendance calendar (for the member-facing app/portal). */
  async memberHistory(memberId: string, gymId: string, month?: number, year?: number) {
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
  async liveFeed(gymId: string) {
    return this.prisma.attendance.findMany({
      where: { gymId, checkOutAt: null },
      orderBy: { checkInAt: 'desc' },
      take: 50,
      include: { member: { select: { id: true, firstName: true, lastName: true, photo: true } } },
    });
  }

  /** Flags sessions still open past closing time �?" feeds the "missed checkout" report. */
  async missedCheckouts(gymId: string, hoursThreshold = 4) {
    const cutoff = new Date(Date.now() - hoursThreshold * 60 * 60 * 1000);
    return this.prisma.attendance.findMany({
      where: { gymId, checkOutAt: null, checkInAt: { lt: cutoff } },
      include: { member: { select: { id: true, firstName: true, lastName: true, mobile: true } } },
    });
  }
}
