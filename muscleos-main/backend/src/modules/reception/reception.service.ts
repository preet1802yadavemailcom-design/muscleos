import { PrismaService } from '@database/prisma.service';
import { AttendanceService } from '@modules/attendance/attendance.service';
import { CreateMemberDto } from '@modules/members/dto/create-member.dto';
import { MembersService } from '@modules/members/members.service';
import { RenewMembershipDto } from '@modules/memberships/dto/renew-membership.dto';
import { MembershipsService } from '@modules/memberships/memberships.service';
import { CreatePaymentDto } from '@modules/payments/dto/create-payment.dto';
import { PaymentsService } from '@modules/payments/payments.service';
import { Injectable } from '@nestjs/common';

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

  /** Front-desk landing snapshot: today's check-ins, expiring memberships, pending payments. */
  async dashboard(gymId: string) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const [todayCheckIns, expiringSoon, pendingPayments, activeMembers] = await Promise.all([
      this.prisma.attendance.count({
        where: { gymId, checkInAt: { gte: startOfDay, lte: endOfDay } },
      }),
      this.prisma.membership.count({
        where: {
          gymId,
          status: 'ACTIVE',
          endDate: { gte: new Date(), lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
        },
      }),
      this.prisma.payment.count({ where: { gymId, status: 'PENDING' } }),
      this.prisma.member.count({ where: { gymId, status: 'ACTIVE', deletedAt: null } }),
    ]);

    return { todayCheckIns, expiringSoon, pendingPayments, activeMembers };
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
