import { PrismaService } from '@database/prisma.service';
import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { AttendanceType, AttendanceStatus, MembershipStatus, UserStatus, Prisma } from '@prisma/client';
import { AuditService } from '@shared/services/audit.service';
import { EncryptionService } from '@shared/services/encryption.service';

import { ScanQrDto, QueryAttendanceDto } from './dto';


/** Grace window (minutes) before a batch start counts as "late". */
const LATE_GRACE_MINUTES = 10;
/** Members can't be re-scanned within this window — guards against accidental double-taps. */
const DUPLICATE_SCAN_WINDOW_MINUTES = 2;

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly encryption: EncryptionService,
  ) {}

  /**
   * Core QR scan flow (spec Module 07):
   * decrypt → validate gym/member/membership/batch timing → duplicate guard → check-in/out → duration.
   */
  async scan(scannerGymId: string, dto: ScanQrDto, scannedBy: string) {
    let decoded: { gymId: string; memberId: string; timestamp: number };
    try {
      decoded = this.encryption.decryptQRCodeData(dto.qrCodeData);
    } catch {
      throw new BadRequestException('Invalid or corrupted QR code');
    }

    // 1. Gym match — a member's QR only works at their own gym.
    if (decoded.gymId !== scannerGymId) {
      throw new ForbiddenException('This QR code does not belong to this gym');
    }

    // 2. Member exists & active.
    const member = await this.prisma.member.findFirst({
      where: { id: decoded.memberId, gymId: scannerGymId, deletedAt: null },
      include: { currentMembership: true, batch: true },
    });
    if (!member) throw new NotFoundException('Member not found');
    if (member.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException(`Member is ${member.status.toLowerCase()} — attendance blocked`);
    }

    // 3. Membership validity.
    const membership = member.currentMembership;
    if (!membership || membership.endDate < new Date()) {
      throw new ForbiddenException('No active membership — please renew to check in');
    }
    if (membership.status === MembershipStatus.FROZEN) {
      throw new ForbiddenException('Membership is currently frozen');
    }
    if (membership.status !== MembershipStatus.ACTIVE) {
      throw new ForbiddenException(`Membership is ${membership.status.toLowerCase()} — attendance blocked`);
    }

    // 4. Duplicate-scan guard.
    const recentScan = await this.prisma.attendance.findFirst({
      where: {
        memberId: member.id,
        gymId: scannerGymId,
        checkInAt: { gte: new Date(Date.now() - DUPLICATE_SCAN_WINDOW_MINUTES * 60 * 1000) },
      },
      orderBy: { checkInAt: 'desc' },
    });
    if (recentScan && !recentScan.checkOutAt) {
      // Treat as a check-out if enough time has passed since check-in to be meaningful,
      // otherwise reject as an accidental double-scan.
      const secondsSinceCheckIn = (Date.now() - recentScan.checkInAt.getTime()) / 1000;
      if (secondsSinceCheckIn < 30) {
        throw new BadRequestException('Duplicate scan — please wait a moment before scanning again');
      }
    }

    // 5. Find an open (not checked-out) session today to decide check-in vs check-out.
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const openSession = await this.prisma.attendance.findFirst({
      where: {
        memberId: member.id,
        gymId: scannerGymId,
        checkInAt: { gte: startOfDay },
        checkOutAt: null,
      },
      orderBy: { checkInAt: 'desc' },
    });

    if (openSession) {
      return this.checkOut(openSession.id, dto, scannedBy);
    }
    return this.checkIn(member, dto, scannedBy);
  }

  private async checkIn(member: any, dto: ScanQrDto, scannedBy: string) {
    const now = new Date();
    let isLate = false;
    let lateMinutes = 0;

    // Batch timing validation — only meaningful when the member belongs to a fixed-time batch.
    if (member.batch) {
      const { startTime, days } = member.batch as { startTime: string; days: string[] };
      const todayName = now.toLocaleDateString('en-US', { weekday: 'long' });
      if (days?.length && !days.includes(todayName)) {
        throw new ForbiddenException(`This member's batch does not run on ${todayName}`);
      }
      if (startTime) {
        const [h, m] = startTime.split(':').map(Number);
        const batchStart = new Date(now);
        batchStart.setHours(h, m, 0, 0);
        const diffMinutes = (now.getTime() - batchStart.getTime()) / 60000;
        if (diffMinutes > LATE_GRACE_MINUTES) {
          isLate = true;
          lateMinutes = Math.round(diffMinutes);
        }
      }
    }

    const attendance = await this.prisma.attendance.create({
      data: {
        memberId: member.id,
        batchId: member.batchId,
        type: AttendanceType.CHECK_IN,
        status: isLate ? AttendanceStatus.LATE : AttendanceStatus.PRESENT,
        checkInAt: now,
        isLate,
        lateMinutes,
        deviceType: dto.deviceType,
        scannedBy,
        location: dto.location,
        gymId: member.gymId,
      },
    });

    await this.audit.log({
      action: 'CHECK_IN',
      entity: 'Attendance',
      entityId: attendance.id,
      userId: scannedBy,
      gymId: member.gymId,
      newValue: { memberId: member.id, isLate, lateMinutes },
    });

    return { ...attendance, member: { id: member.id, name: `${member.firstName} ${member.lastName}`, photo: member.photo } };
  }

  private async checkOut(attendanceId: string, dto: ScanQrDto, scannedBy: string) {
    const existing = await this.prisma.attendance.findUnique({
      where: { id: attendanceId },
      include: { member: true, batch: true },
    });
    if (!existing) throw new NotFoundException('Open attendance session not found');

    const now = new Date();
    const durationMinutes = Math.round((now.getTime() - existing.checkInAt.getTime()) / 60000);

    let isEarlyLeave = false;
    if (existing.batch?.endTime) {
      const [h, m] = existing.batch.endTime.split(':').map(Number);
      const batchEnd = new Date(existing.checkInAt);
      batchEnd.setHours(h, m, 0, 0);
      if (now < batchEnd) isEarlyLeave = true;
    }

    const attendance = await this.prisma.attendance.update({
      where: { id: attendanceId },
      data: {
        checkOutAt: now,
        duration: durationMinutes,
        isEarlyLeave,
        type: AttendanceType.CHECK_OUT,
      },
    });

    await this.audit.log({
      action: 'CHECK_OUT',
      entity: 'Attendance',
      entityId: attendance.id,
      userId: scannedBy,
      gymId: existing.gymId,
      newValue: { durationMinutes, isEarlyLeave },
    });

    return {
      ...attendance,
      member: { id: existing.member.id, name: `${existing.member.firstName} ${existing.member.lastName}` },
    };
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

  /** Flags sessions still open past closing time — feeds the "missed checkout" report. */
  async missedCheckouts(gymId: string, hoursThreshold = 4) {
    const cutoff = new Date(Date.now() - hoursThreshold * 60 * 60 * 1000);
    return this.prisma.attendance.findMany({
      where: { gymId, checkOutAt: null, checkInAt: { lt: cutoff } },
      include: { member: { select: { id: true, firstName: true, lastName: true, mobile: true } } },
    });
  }
}
