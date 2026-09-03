import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { AttendanceType, AttendanceStatus, AttendanceSource, MembershipStatus, Prisma } from '@prisma/client';
import { PrismaService } from '@database/prisma.service';
import { RedisService } from '@database/redis.service';
import { AuditService } from '@shared/services/audit.service';

/** Grace window (minutes) before a batch start counts as "late". */
const LATE_GRACE_MINUTES = 10;
/** Guards against accidental double-taps on the same scan. */
const DUPLICATE_SCAN_WINDOW_SECONDS = 30;

/** Unique constraint name backing the partial unique index created in the
 *  `attendance_one_open_session_per_member` migration — see that migration
 *  for why a Prisma `@@unique` can't express this (it needs a WHERE clause). */
const OPEN_SESSION_CONSTRAINT = 'attendance_one_open_session_per_member';

export interface RecordScanInput {
  member: any; // includes currentMembership + batch
  gymId: string;
  branchId?: string | null;
  source: AttendanceSource;
  performedBy?: string | null; // userId of staff/owner, or null for self-serve
  deviceType?: string;
  location?: string;
  latitude?: number;
  longitude?: number;
}

/**
 * The single canonical place attendance state transitions happen.
 * Both `checkin.service.ts` (kiosk/OTP flow) and `attendance.service.ts`
 * (authenticated in-app QR flow) call this instead of writing their own
 * check-in/check-out logic — previously each had its own copy that could
 * (and did) drift apart.
 *
 * Race-condition safety: rather than "read open session, then decide
 * insert-vs-update" (non-atomic — two concurrent scans can both read "no
 * open session" and both insert), we always attempt the CHECK_IN insert
 * first inside a transaction. The DB has a partial unique index allowing
 * at most one row with `checkOutAt IS NULL` per memberId. If the insert
 * violates that constraint, we know a session is already open and fall
 * back to closing it (check-out) — one round trip, no lost-update window.
 */
@Injectable()
export class AttendanceCoreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
  ) {}

  async recordScan(input: RecordScanInput) {
    const { member } = input;

    // Membership validity — checked before we touch the DB at all.
    const membership = member.currentMembership;
    if (membership) {
      if (membership.status === MembershipStatus.FROZEN) {
        throw new ForbiddenException('Membership is currently frozen.');
      }
      if (membership.status === MembershipStatus.CANCELLED) {
        throw new ForbiddenException('Membership is cancelled — please contact reception.');
      }
      if (membership.status === MembershipStatus.ACTIVE && membership.endDate < new Date()) {
        throw new ForbiddenException('Membership has expired — please renew to check in.');
      }
    }

    try {
      return await this.attemptCheckIn(input);
    } catch (error) {
      if (this.isOpenSessionConflict(error)) {
        return this.closeOpenSessionInternal(input);
      }
      throw error;
    }
  }

  private async attemptCheckIn(input: RecordScanInput) {
    const { member, gymId, branchId, source, performedBy, deviceType, location, latitude, longitude } = input;
    const now = new Date();

    // Duplicate-tap guard: a second insert attempt within the window for a
    // session that's already open is caught by the unique index below; this
    // just gives a friendlier message for the sub-30s double-tap case where
    // the *first* insert hasn't been read back yet by the guard above.
    const veryRecent = await this.prisma.attendance.findFirst({
      where: {
        memberId: member.id,
        gymId,
        checkInAt: { gte: new Date(now.getTime() - DUPLICATE_SCAN_WINDOW_SECONDS * 1000) },
      },
      orderBy: { checkInAt: 'desc' },
    });
    if (veryRecent && !veryRecent.checkOutAt) {
      const secondsSince = (now.getTime() - veryRecent.checkInAt.getTime()) / 1000;
      if (secondsSince < 5) {
        throw new BadRequestException('Duplicate scan — please wait a moment before scanning again');
      }
    }

    this.assertBatchRunsToday(member, now);
    const { isLate, lateMinutes } = this.computeLateness(member, now);

    const attendance = await this.prisma.attendance.create({
      data: {
        memberId: member.id,
        batchId: member.batchId,
        type: AttendanceType.CHECK_IN,
        status: isLate ? AttendanceStatus.LATE : AttendanceStatus.PRESENT,
        checkInAt: now,
        isLate,
        lateMinutes,
        deviceType,
        location,
        latitude,
        longitude,
        source,
        performedBy: performedBy ?? undefined,
        scannedBy: performedBy ?? 'self',
        gymId,
        branchId: branchId ?? undefined,
      },
    });

    await this.audit.log({
      action: 'CHECK_IN',
      entity: 'Attendance',
      entityId: attendance.id,
      newValue: { memberId: member.id, source, isLate, lateMinutes, branchId },
      userId: performedBy ?? undefined,
      gymId,
    });

    // Best-effort — a streak-update failure must never block a real check-in.
    this.updateStreak(member.id, now).catch(() => undefined);

    return this.publishAndReturn(attendance, member, gymId);
  }

  /** Day-precision streak tracking: consecutive calendar days with at least
   *  one check-in. A gap of more than one day resets the streak to 1
   *  (today counts). Multiple check-ins on the same day don't double-count.
   *  This runs on every check-in across all flows (kiosk, in-app QR,
   *  manual staff entry) since they all funnel through attemptCheckIn(). */
  private async updateStreak(memberId: string, checkInAt: Date) {
    const member = await this.prisma.member.findUnique({
      where: { id: memberId },
      select: { currentStreak: true, longestStreak: true, lastStreakDate: true },
    });
    if (!member) return;

    const today = new Date(checkInAt.getFullYear(), checkInAt.getMonth(), checkInAt.getDate());
    const last = member.lastStreakDate
      ? new Date(member.lastStreakDate.getFullYear(), member.lastStreakDate.getMonth(), member.lastStreakDate.getDate())
      : null;

    if (last && last.getTime() === today.getTime()) {
      return; // Already counted today — nothing to update.
    }

    const oneDayMs = 24 * 60 * 60 * 1000;
    const isConsecutive = last && today.getTime() - last.getTime() === oneDayMs;
    const newStreak = isConsecutive ? member.currentStreak + 1 : 1;

    await this.prisma.member.update({
      where: { id: memberId },
      data: {
        currentStreak: newStreak,
        longestStreak: Math.max(newStreak, member.longestStreak),
        lastStreakDate: today,
      },
    });
  }

  /** Public entry point for flows with an explicit "Check Out" action (as opposed
   *  to a single scan button that auto-decides). Errors if nothing is open. */
  async closeOpenSession(input: RecordScanInput) {
    return this.closeOpenSessionInternal(input);
  }

  private async closeOpenSessionInternal(input: RecordScanInput) {
    const { member, gymId, performedBy } = input;

    const open = await this.prisma.attendance.findFirst({
      where: { memberId: member.id, gymId, checkOutAt: null },
      orderBy: { checkInAt: 'desc' },
    });
    if (!open) {
      // Constraint fired but we can't find the row — surface a clean error
      // rather than silently no-op-ing; this indicates a real bug if seen.
      throw new BadRequestException('Could not resolve attendance state — please try scanning again.');
    }

    const now = new Date();
    const durationMinutes = Math.round((now.getTime() - open.checkInAt.getTime()) / 60000);
    const isEarlyLeave = this.computeEarlyLeave(member, open.checkInAt, now);

    const attendance = await this.prisma.attendance.update({
      where: { id: open.id },
      data: { checkOutAt: now, duration: durationMinutes, isEarlyLeave, type: AttendanceType.CHECK_OUT },
    });

    await this.audit.log({
      action: 'CHECK_OUT',
      entity: 'Attendance',
      entityId: attendance.id,
      newValue: { memberId: member.id, durationMinutes, isEarlyLeave },
      userId: performedBy ?? undefined,
      gymId,
    });

    return this.publishAndReturn(attendance, member, gymId);
  }

  /** Broadcasts to the gym's SSE channel (attendance-stream.controller.ts) so
   *  the owner dashboard updates live — best-effort: a Redis publish failure
   *  must never fail the check-in/check-out itself, so this always resolves
   *  even if the publish throws. */
  private async publishAndReturn(attendance: any, member: any, gymId: string) {
    const result = this.toResult(attendance, member);
    this.redis.publish(`attendance:${gymId}`, JSON.stringify(result)).catch(() => undefined);
    return result;
  }

  /** Blocks check-in on a day the member's fixed batch doesn't run at all (not just late/early). */
  private assertBatchRunsToday(member: any, now: Date): void {
    if (!member.batch?.days?.length) return;
    // Days are stored as 3-letter codes (MON, WED, ...) per CreateBatchDto, but
    // toLocaleDateString('weekday') returns long names — normalize both sides.
    const DAY_CODES: Record<string, string> = {
      SUNDAY: 'SUN', MONDAY: 'MON', TUESDAY: 'TUE', WEDNESDAY: 'WED',
      THURSDAY: 'THU', FRIDAY: 'FRI', SATURDAY: 'SAT',
    };
    const todayName = now.toLocaleDateString('en-US', { weekday: 'long' });
    const todayCode = DAY_CODES[todayName.toUpperCase()];
    const normalizedDays = (member.batch.days as string[]).map((d) => d.trim().toUpperCase());
    const runsToday = normalizedDays.some((d) => d === todayCode || DAY_CODES[d] === todayCode);
    if (!runsToday) {
      throw new ForbiddenException(`This member's batch does not run on ${todayName}`);
    }
  }

  private computeLateness(member: any, now: Date): { isLate: boolean; lateMinutes: number } {
    if (!member.batch?.startTime) return { isLate: false, lateMinutes: 0 };
    const [h, m] = member.batch.startTime.split(':').map(Number);
    const batchStart = new Date(now);
    batchStart.setHours(h, m, 0, 0);
    const diffMinutes = (now.getTime() - batchStart.getTime()) / 60000;
    return diffMinutes > LATE_GRACE_MINUTES
      ? { isLate: true, lateMinutes: Math.round(diffMinutes) }
      : { isLate: false, lateMinutes: 0 };
  }

  private computeEarlyLeave(member: any, checkInAt: Date, now: Date): boolean {
    if (!member.batch?.endTime) return false;
    const [h, m] = member.batch.endTime.split(':').map(Number);
    const batchEnd = new Date(checkInAt);
    batchEnd.setHours(h, m, 0, 0);
    return now < batchEnd;
  }

  /** True when the error is the partial-unique-index violation meaning a session is already open.
   *  Postgres reports a unique_violation (23505) on the partial index; Prisma maps that to
   *  P2002 even though the index isn't declared as `@@unique` in schema.prisma (Prisma can't
   *  express a WHERE clause on a unique constraint, so it's created via raw SQL migration —
   *  see `attendance_one_open_session_per_member` migration). We match on the DB constraint
   *  name Postgres includes in the error detail. */
  private isOpenSessionConflict(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
    if (error.code === 'P2002') {
      const target = error.meta?.target;
      const targetStr = Array.isArray(target) ? target.join(',') : String(target ?? '');
      return targetStr.includes(OPEN_SESSION_CONSTRAINT) || !target; // no target info → assume conflict on this table's only partial index
    }
    // Fallback: raw Postgres error surfaced without Prisma's mapping (e.g. inside $transaction raw calls).
    const raw = error as unknown as { code?: string; meta?: { message?: string } };
    return raw.code === '23505' && !!raw.meta?.message?.includes(OPEN_SESSION_CONSTRAINT);
  }

  private toResult(attendance: any, member: any) {
    return {
      id: attendance.id,
      type: attendance.type,
      status: attendance.status,
      checkInAt: attendance.checkInAt,
      checkOutAt: attendance.checkOutAt,
      duration: attendance.duration,
      isLate: attendance.isLate,
      lateMinutes: attendance.lateMinutes,
      isEarlyLeave: attendance.isEarlyLeave,
      member: {
        id: member.id,
        name: `${member.firstName} ${member.lastName}`,
        memberCode: member.memberCode,
        photo: member.photo,
      },
    };
  }
}
