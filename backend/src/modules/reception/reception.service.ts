import { PrismaService } from '@database/prisma.service';
import { AttendanceService } from '@modules/attendance/attendance.service';
import { CreateMemberDto } from '@modules/members/dto/create-member.dto';
import { MembersService } from '@modules/members/members.service';
import { RenewMembershipDto } from '@modules/memberships/dto/renew-membership.dto';
import { MembershipsService } from '@modules/memberships/memberships.service';
import { CreatePaymentDto } from '@modules/payments/dto/create-payment.dto';
import { PaymentsService } from '@modules/payments/payments.service';
import { Injectable } from '@nestjs/common';
import { getGymStartOfDay, getGymEndOfDay } from '@common/utils/timezone.util';

/**
 * Reception facade (Module 10).
 * Reception staff have a narrow, task-focused slice of the system:
 * register members, collect payment + receipt, check attendance,
 * search members, and renew memberships. No report/analytics access —
 * that is deliberately NOT exposed here (see ReportsModule, gated to
 * GYM_OWNER/SUPER_ADMIN only).
 *
 * This composes the existing domain services rather than owning its
 * own table, so every action is fully consistent with what a gym
 * owner or the member portal would see.
 */
@Injectable()
export class ReceptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly members: MembersService,
    private readonly payments: PaymentsService,
    private readonly attendance: AttendanceService,
    private readonly memberships: MembershipsService,
  ) {}

  /** Front-desk landing snapshot: today's check-ins, expiring memberships, pending payments (with optional batch filter). */
  async dashboard(gymId: string, batchId?: string) {
    const startOfDay = getGymStartOfDay();
    const endOfDay = getGymEndOfDay();

    const attendanceWhere: any = { gymId, checkInAt: { gte: startOfDay, lte: endOfDay } };
    if (batchId) attendanceWhere.batchId = batchId;

    const membershipWhere: any = {
      gymId,
      status: 'ACTIVE',
      endDate: { gte: new Date(), lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
    };
    if (batchId) membershipWhere.member = { batchId };

    const paymentWhere: any = { gymId, status: 'PENDING', deletedAt: null };
    if (batchId) paymentWhere.member = { batchId };

    const memberWhere: any = { gymId, status: 'ACTIVE', deletedAt: null };
    if (batchId) memberWhere.batchId = batchId;

    const [todayCheckIns, expiringSoon, pendingPayments, activeMembers] = await Promise.all([
      this.prisma.attendance.count({ where: attendanceWhere }),
      this.prisma.membership.count({ where: membershipWhere }),
      this.prisma.payment.count({ where: paymentWhere }),
      this.prisma.member.count({ where: memberWhere }),
    ]);

    return { todayCheckIns, expiringSoon, pendingPayments, activeMembers };
  }

  /** Lists all active batches for the gym with current member counts and capacity. */
  async getBatches(gymId: string) {
    return this.prisma.batch.findMany({
      where: { gymId, deletedAt: null, status: 'ACTIVE' },
      select: {
        id: true,
        name: true,
        startTime: true,
        endTime: true,
        capacity: true,
        days: true,
        _count: {
          select: {
            members: { where: { deletedAt: null, status: 'ACTIVE' } },
          },
        },
      },
      orderBy: { startTime: 'asc' },
    });
  }

  /** Drill-down: today's check-ins with batch and search filter. */
  async getCheckinsToday(gymId: string, batchId?: string, search?: string) {
    const startOfDay = getGymStartOfDay();
    const endOfDay = getGymEndOfDay();

    const where: any = {
      gymId,
      checkInAt: { gte: startOfDay, lte: endOfDay },
    };
    if (batchId) {
      where.batchId = batchId;
    }
    if (search) {
      where.member = {
        OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { memberCode: { contains: search, mode: 'insensitive' } },
          { mobile: { contains: search } },
        ],
      };
    }

    return this.prisma.attendance.findMany({
      where,
      orderBy: { checkInAt: 'desc' },
      include: {
        member: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            memberCode: true,
            mobile: true,
            photo: true,
            batch: { select: { id: true, name: true } },
            currentMembership: { select: { planName: true, status: true } },
          },
        },
        batch: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
      },
    });
  }

  /** Drill-down: active members with batch and search filter. */
  async getActiveMembers(gymId: string, batchId?: string, search?: string) {
    const where: any = {
      gymId,
      status: 'ACTIVE',
      deletedAt: null,
    };
    if (batchId) {
      where.batchId = batchId;
    }
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { memberCode: { contains: search, mode: 'insensitive' } },
        { mobile: { contains: search } },
      ];
    }

    return this.prisma.member.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        batch: { select: { id: true, name: true, startTime: true, endTime: true } },
        trainer: { select: { id: true, firstName: true, lastName: true } },
        currentMembership: { select: { id: true, planName: true, status: true, endDate: true } },
      },
    });
  }

  /** Drill-down: members whose active membership expires in next N days. */
  async getExpiringMembers(gymId: string, batchId?: string, days = 7) {
    const now = new Date();
    const threshold = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    const where: any = {
      gymId,
      status: 'ACTIVE',
      deletedAt: null,
      currentMembership: {
        is: {
          status: 'ACTIVE',
          endDate: { gte: now, lte: threshold },
        },
      },
    };
    if (batchId) {
      where.batchId = batchId;
    }

    return this.prisma.member.findMany({
      where,
      orderBy: { currentMembership: { endDate: 'asc' } },
      include: {
        batch: { select: { id: true, name: true } },
        currentMembership: { select: { id: true, planName: true, endDate: true, status: true } },
      },
    });
  }

  /** Drill-down: pending payments list. */
  async getPendingPayments(gymId: string, batchId?: string) {
    const where: any = {
      gymId,
      status: 'PENDING',
      deletedAt: null,
    };
    if (batchId) {
      where.member = { batchId };
    }

    return this.prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        member: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            memberCode: true,
            mobile: true,
            photo: true,
            batch: { select: { id: true, name: true } },
          },
        },
      },
    });
  }

  /** Register a walk-in member. Delegates to MembersService for full validation, QR issuance, etc. */
  registerMember(gymId: string, dto: CreateMemberDto) {
    return this.members.create(gymId, dto);
  }

  /** Quick member lookup by name / mobile / email / member code. */
  searchMembers(gymId: string, search: string) {
    return this.members.findAll(gymId, { search, page: 1, limit: 10 } as any);
  }

  /** Collect a payment and generate a receipt/invoice for a member at the counter. */
  collectPayment(gymId: string, dto: CreatePaymentDto, collectedById: string) {
    return this.payments.initiate(dto, gymId, collectedById);
  }

  downloadReceipt(paymentId: string, gymId: string) {
    return this.payments.downloadReceipt(paymentId, gymId);
  }

  /** Renew a member's membership from the front desk. */
  renewMembership(membershipId: string, gymId: string, dto: RenewMembershipDto) {
    return this.memberships.renew(membershipId, gymId, dto);
  }

  /** Today's live attendance feed for the front desk. */
  todayAttendance(gymId: string) {
    return this.attendance.liveFeed(gymId);
  }

  memberAttendanceHistory(memberId: string, gymId: string, month?: number, year?: number) {
    return this.attendance.memberHistory(memberId, gymId, month, year);
  }
}
