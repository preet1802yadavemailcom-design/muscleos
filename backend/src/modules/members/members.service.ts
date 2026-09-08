
function normalizeMobile(mobile?: string | null): string | null {
  if (!mobile) return null;
  const digits = mobile.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits.slice(2);
  }
  return digits.length > 0 ? digits : null;
}

function normalizeEmail(email?: string | null): string | null {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

import { randomUUID, randomBytes } from 'crypto';

import { CurrentUserPayload } from '@common/decorators/current-user.decorator';
import { PrismaService } from '@database/prisma.service';
import { Optional, Injectable, NotFoundException, BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common';
import { UserStatus, MembershipStatus, Prisma } from '@prisma/client';
import { AccessScopeService } from '@shared/services/access-scope.service';
import { AuditService } from '@shared/services/audit.service';
import { EncryptionService } from '@shared/services/encryption.service';
import { SequenceService } from '@shared/services/sequence.service';

import { CreateMemberDto, UpdateMemberDto, QueryMemberDto } from './dto';

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly encryption: EncryptionService,
    private readonly sequence: SequenceService,
    @Optional() private readonly accessScope?: AccessScopeService,
  ) {}

  async findAll(gymId: string, query: QueryMemberDto, user?: CurrentUserPayload) {
    const { page = 1, limit = 20, search, status, batchId, trainerId, expired } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.MemberWhereInput = { gymId, deletedAt: null };
    if (this.accessScope?.isBranchScoped(user)) {
      where.branchId = user!.branchId;
    }
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { mobile: { contains: search } },
        { email: { contains: search, mode: 'insensitive' } },
        { memberCode: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (status) where.status = status;
    if (batchId) where.batchId = batchId;
    if (query.batchStatus === 'NONE') {
      where.batchId = null;
    } else if (query.batchStatus === 'ASSIGNED') {
      where.batchId = { not: null };
    }
    if (trainerId) where.trainerId = trainerId;
    if (expired) {
      where.currentMembership = { is: { endDate: { lt: new Date() } } };
    }

    const [data, total] = await Promise.all([
      this.prisma.member.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          batch: { select: { id: true, name: true } },
          trainer: { select: { id: true, firstName: true, lastName: true } },
          currentMembership: { select: { id: true, planName: true, endDate: true, status: true } },
        },
      }),
      this.prisma.member.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1,
      },
    };
  }

  /** Export the filtered member list as flat rows ready for PDF/Excel/CSV generation. */
  async exportData(gymId: string, query: QueryMemberDto, user?: CurrentUserPayload) {
    const { search, status, batchId, trainerId } = query;
    const where: Prisma.MemberWhereInput = { gymId, deletedAt: null };
    if (this.accessScope?.isBranchScoped(user)) {
      where.branchId = user!.branchId;
    }
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { mobile: { contains: search } },
        { email: { contains: search, mode: 'insensitive' } },
        { memberCode: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (status) where.status = status;
    if (batchId) where.batchId = batchId;
    if (trainerId) where.trainerId = trainerId;

    const members = await this.prisma.member.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        batch: { select: { name: true } },
        trainer: { select: { firstName: true, lastName: true } },
        currentMembership: { select: { planName: true, endDate: true, status: true } },
      },
    });

    return members.map((m) => ({
      memberCode: m.memberCode,
      name: `${m.firstName} ${m.lastName}`,
      mobile: m.mobile,
      email: m.email,
      status: m.status,
      batch: m.batch?.name ?? '-',
      trainer: m.trainer ? `${m.trainer.firstName} ${m.trainer.lastName}` : '-',
      plan: m.currentMembership?.planName ?? '-',
      membershipStatus: m.currentMembership?.status ?? '-',
      expiryDate: m.currentMembership?.endDate ?? '-',
      joinedAt: m.createdAt,
    }));
  }

  async findOne(id: string, gymId: string, requester?: CurrentUserPayload | { role?: string; permissions?: string[] }) {
    const member = await this.prisma.member.findFirst({
      where: { id, gymId, deletedAt: null },
      include: {
        batch: true,
        trainer: { select: { id: true, firstName: true, lastName: true } },
        currentMembership: true,
        memberships: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
    });
    if (!member) throw new NotFoundException('Member not found');
    if (this.accessScope && (requester as CurrentUserPayload)?.userId) {
      this.accessScope.assertBranchAccess(requester as CurrentUserPayload, member.branchId);
    }
    return this.sanitizeMemberSensitiveData(member, requester);
  }

  /**
   * Field-level privacy projection: strips or redacts medical notes,
   * allergies, medications, private contact numbers, and personal details
   * unless the caller is an owner/super-admin or has explicit 'members:sensitive:read' permission.
   */
  sanitizeMemberSensitiveData(member: any, requester?: { role?: string; permissions?: string[] }) {
    if (!member) return member;
    const isOwnerOrSuper = requester?.role === 'GYM_OWNER' || requester?.role === 'SUPER_ADMIN';
    const hasSensitivePerm = requester?.permissions?.includes('members:sensitive:read');

    if (isOwnerOrSuper || hasSensitivePerm) {
      return member;
    }

    return {
      ...member,
      medicalNotes: null,
      allergies: [],
      medications: [],
      emergencyContactName: member.emergencyContactName ? '[CONFIDENTIAL]' : null,
      emergencyContactPhone: member.emergencyContactPhone ? '[CONFIDENTIAL]' : null,
      address: member.address ? '[CONFIDENTIAL]' : null,
      dateOfBirth: null,
    };
  }

  /**
   * Owner-facing Member 360: one combined view of membership history,
   * recent attendance, recent payments and account/verification state
   * per the spec's "Owner/Staff Member 360" profile requirement. Read-only
   * aggregation; does not create or mutate anything.
   */
  async getMember360(id: string, gymId: string, requester?: CurrentUserPayload | { role?: string; permissions?: string[] }) {
    const member = await this.prisma.member.findFirst({
      where: { id, gymId, deletedAt: null },
      include: {
        batch: true,
        branch: { select: { id: true, name: true } },
        trainer: { select: { id: true, firstName: true, lastName: true } },
        currentMembership: true,
        memberships: { orderBy: { createdAt: 'desc' } },
        user: { select: { id: true, phoneVerified: true, whatsappVerified: true, createdAt: true } },
      },
    });
    if (!member) throw new NotFoundException('Member not found');
    if (this.accessScope && (requester as CurrentUserPayload)?.userId) {
      this.accessScope.assertBranchAccess(requester as CurrentUserPayload, member.branchId);
    }

    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [attendance, payments, lastPayment, activeDietPlan, activeWorkoutPlan, totalVisits, thisWeekVisits, thisMonthVisits] = await Promise.all([
      this.prisma.attendance.findMany({
        where: { memberId: id, gymId },
        orderBy: { checkInAt: 'desc' },
        take: 30,
        include: {
          batch: { select: { id: true, name: true } },
          branch: { select: { id: true, name: true } },
        },
      }),
      this.prisma.payment.findMany({
        where: { memberId: id, gymId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 30,
        include: {
          monthAllocations: { include: { membershipMonth: { select: { monthStart: true } } } },
          verifiedBy: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.payment.findFirst({
        where: { memberId: id, gymId, deletedAt: null, status: 'COMPLETED' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, total: true },
      }),
      this.prisma.dietPlan?.findFirst
        ? this.prisma.dietPlan.findFirst({
            where: { memberId: id, gymId, isActive: true },
            include: { meals: { orderBy: { order: 'asc' } } },
          })
        : Promise.resolve(null),
      this.prisma.workoutPlan?.findFirst
        ? this.prisma.workoutPlan.findFirst({
            where: { memberId: id, gymId, isActive: true },
            include: { days: { include: { exercises: { orderBy: { order: 'asc' } } }, orderBy: { order: 'asc' } } },
          })
        : Promise.resolve(null),
      this.prisma.attendance.count({ where: { memberId: id, gymId } }),
      this.prisma.attendance.count({ where: { memberId: id, gymId, checkInAt: { gte: oneWeekAgo } } }),
      this.prisma.attendance.count({ where: { memberId: id, gymId, checkInAt: { gte: startOfMonth } } }),
    ]);

    const attendanceStats = {
      totalVisits,
      thisWeek: thisWeekVisits,
      thisMonth: thisMonthVisits,
      currentStreak: member.currentStreak || 0,
      longestStreak: member.longestStreak || 0,
      lastCheckIn: attendance[0]?.checkInAt ?? null,
    };

    const accountState = !member.userId
      ? 'NOT_LINKED'
      : member.claimTokenExpiresAt && member.claimTokenExpiresAt > new Date()
        ? 'ACTIVATION_PENDING'
        : 'LINKED';

    return {
      member: this.sanitizeMemberSensitiveData(member, requester),
      accountState,
      lastVisit: attendance[0]?.checkInAt ?? null,
      lastPayment: lastPayment ?? null,
      attendanceStats,
      attendance,
      payments,
      activeDietPlan,
      activeWorkoutPlan,
    };
  }

  async create(gymId: string, dto: CreateMemberDto, user?: CurrentUserPayload) {
    const cleanMobile = normalizeMobile(dto.mobile);
    if (cleanMobile) {
      const duplicateMobile = await this.prisma.member.findFirst({
        where: {
          gymId,
          deletedAt: null,
          OR: [
            { mobile: cleanMobile },
            { mobile: dto.mobile },
            { mobile: `+91${cleanMobile}` },
          ],
        },
      });
      if (duplicateMobile) {
        throw new ConflictException('Mobile number is already registered.');
      }
    }

    const cleanEmail = normalizeEmail(dto.email);
    if (cleanEmail) {
      const duplicateEmail = await this.prisma.member.findFirst({
        where: {
          gymId,
          deletedAt: null,
          email: { equals: cleanEmail, mode: 'insensitive' },
        },
      });
      if (duplicateEmail) {
        throw new ConflictException('Email address is already registered.');
      }
    }

    if (this.accessScope?.isBranchScoped(user)) {
      dto.branchId = user!.branchId;
    }
    if (dto.branchId) {
      const branch = await this.prisma.branch.findFirst({ where: { id: dto.branchId, gymId, deletedAt: null } });
      if (!branch) throw new BadRequestException('Branch not found in this gym');
      if (this.accessScope?.isBranchScoped(user)) {
        this.accessScope.assertBranchAccess(user, dto.branchId);
      }
    }

    // Cross-tenant integrity: a batchId/trainerId from another gym must never
    // be assignable here just because the FK target happens to exist in the DB.
    if (dto.batchId) {
      const batch = await this.prisma.batch.findFirst({ where: { id: dto.batchId, gymId } });
      if (!batch) throw new ForbiddenException('This batch does not belong to your gym.');
      const enrolled = await this.prisma.member.count({
        where: { batchId: dto.batchId, gymId, deletedAt: null, status: 'ACTIVE' },
      });
      if (enrolled >= batch.capacity) {
        throw new ConflictException(`Batch "${batch.name}" is already at full capacity (${batch.capacity} members).`);
      }
    }
    if (dto.trainerId) {
      const trainer = await this.prisma.user.findFirst({ where: { id: dto.trainerId, gymId } });
      if (!trainer) throw new ForbiddenException('This trainer does not belong to your gym.');
    }

    const memberCode = await this.generateMemberCode(gymId);
    const memberId = randomUUID();
    const qrCodeData = this.encryption.generateQRCodeData(memberId, gymId);
    const qrCode = this.encryption.hash(qrCodeData); // stable short reference, never exposes memberId directly

    const referralCode = `${memberCode}-REF`;

    const member = await this.prisma.member.create({
      data: {
        id: memberId,
        memberCode,
        photo: dto.photo,
        firstName: dto.firstName,
        lastName: dto.lastName,
        gender: dto.gender,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
        bloodGroup: dto.bloodGroup,
        mobile: dto.mobile,
        email: dto.email,
        emergencyContactName: dto.emergencyContactName,
        emergencyContactPhone: dto.emergencyContactPhone,
        address: dto.address,
        city: dto.city,
        state: dto.state,
        pincode: dto.pincode,
        medicalNotes: dto.medicalNotes,
        allergies: dto.allergies ?? [],
        medications: dto.medications ?? [],
        trainerId: dto.trainerId,
        batchId: dto.batchId,
        branchId: dto.branchId,
        referredBy: dto.referredBy,
        referralCode,
        qrCode,
        qrCodeData,
        status: UserStatus.ACTIVE,
        gymId,
      },
    });

    await this.audit.log({
      action: 'CREATE',
      entity: 'Member',
      entityId: member.id,
      newValue: { memberCode: member.memberCode, firstName: member.firstName, lastName: member.lastName },
      gymId,
    });
    return member;
  }

  async update(id: string, gymId: string, dto: UpdateMemberDto, user?: CurrentUserPayload) {
    const existing = await this.findOne(id, gymId, user);

    if (dto.branchId && dto.branchId !== existing.branchId) {
      const branch = await this.prisma.branch.findFirst({ where: { id: dto.branchId, gymId, deletedAt: null } });
      if (!branch) throw new BadRequestException('Branch not found in this gym');
      if (this.accessScope && user) {
        this.accessScope.assertBranchAccess(user, dto.branchId);
      }
    }

    if (dto.batchId && dto.batchId !== existing.batchId) {
      const batch = await this.prisma.batch.findFirst({ where: { id: dto.batchId, gymId } });
      if (!batch) throw new ForbiddenException('This batch does not belong to your gym.');
      const enrolled = await this.prisma.member.count({
        where: { batchId: dto.batchId, gymId, deletedAt: null, status: 'ACTIVE' },
      });
      if (enrolled >= batch.capacity) {
        throw new ConflictException(`Batch "${batch.name}" is already at full capacity (${batch.capacity} members).`);
      }
    }
    if (dto.trainerId) {
      const trainer = await this.prisma.user.findFirst({ where: { id: dto.trainerId, gymId } });
      if (!trainer) throw new ForbiddenException('This trainer does not belong to your gym.');
    }

    const cleanMobile = normalizeMobile(dto.mobile);
    if (cleanMobile && dto.mobile !== existing.mobile) {
      const duplicateMobile = await this.prisma.member.findFirst({
        where: {
          gymId,
          deletedAt: null,
          id: { not: id },
          OR: [
            { mobile: cleanMobile },
            { mobile: dto.mobile },
            { mobile: `+91${cleanMobile}` },
          ],
        },
      });
      if (duplicateMobile) {
        throw new ConflictException('Mobile number is already registered.');
      }
    }

    const cleanEmail = normalizeEmail(dto.email);
    if (cleanEmail && dto.email !== existing.email) {
      const duplicateEmail = await this.prisma.member.findFirst({
        where: {
          gymId,
          deletedAt: null,
          id: { not: id },
          email: { equals: cleanEmail, mode: 'insensitive' },
        },
      });
      if (duplicateEmail) {
        throw new ConflictException('Email address is already registered.');
      }
    }

    const member = await this.prisma.member.update({
      where: { id },
      data: {
        ...dto,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
      },
    });

    await this.audit.log({
      action: 'UPDATE',
      entity: 'Member',
      entityId: id,
      oldValue: existing,
      newValue: member,
      gymId,
    });

    return member;
  }

  /** Soft-deactivates a member (e.g. cancelled/left the gym) without losing history. */
  async deactivate(id: string, gymId: string, reason?: string, user?: CurrentUserPayload) {
    await this.findOne(id, gymId, user);
    const member = await this.prisma.member.update({
      where: { id },
      data: { status: UserStatus.INACTIVE },
    });
    await this.audit.log({
      action: 'DEACTIVATE',
      entity: 'Member',
      entityId: id,
      newValue: { reason },
      gymId,
    });
    return member;
  }

  async reactivate(id: string, gymId: string, user?: CurrentUserPayload) {
    await this.findOne(id, gymId, user);
    const member = await this.prisma.member.update({
      where: { id },
      data: { status: UserStatus.ACTIVE },
    });
    await this.audit.log({ action: 'REACTIVATE', entity: 'Member', entityId: id, gymId });
    return member;
  }

  /** Soft delete — keeps attendance/payment history intact for reporting/audit purposes. */
  async remove(id: string, gymId: string, user?: CurrentUserPayload) {
    const existing = await this.findOne(id, gymId, user);
    await this.prisma.member.update({
      where: { id },
      data: { deletedAt: new Date(), status: UserStatus.INACTIVE },
    });
    await this.audit.log({
      action: 'DELETE',
      entity: 'Member',
      entityId: id,
      oldValue: existing,
      gymId,
    });
    return { message: 'Member deleted successfully' };
  }

  /** Regenerates the member's QR (e.g. suspected leak / lost ID card) without changing memberCode. */
  async regenerateQr(id: string, gymId: string, user?: CurrentUserPayload) {
    await this.findOne(id, gymId, user);
    const qrCodeData = this.encryption.generateQRCodeData(id, gymId);
    const qrCode = this.encryption.hash(qrCodeData);
    const member = await this.prisma.member.update({
      where: { id },
      data: { qrCode, qrCodeData },
    });
    await this.audit.log({ action: 'QR_REGENERATED', entity: 'Member', entityId: id, gymId });
    return { qrCode: member.qrCode, qrCodeData: member.qrCodeData };
  }

  /** memberCode format: GYM-prefix + zero-padded sequence, e.g. MOS-000123.
   *  Uses the atomic SequenceService instead of count()+1 — two
   *  simultaneous registrations can never be handed the same code. */
  private async generateMemberCode(gymId: string): Promise<string> {
    const gym = await this.prisma.gym.findUnique({ where: { id: gymId }, select: { slug: true } });
    const prefix = (gym?.slug || 'MOS').slice(0, 4).toUpperCase();
    const next = await this.sequence.next(gymId, 'MEMBER_CODE');
    const sequence = next.toString().padStart(6, '0');
    const candidate = `${prefix}-${sequence}`;
    const clash = await this.prisma.member.findUnique({ where: { memberCode: candidate } });
    return clash ? `${prefix}-${Date.now().toString().slice(-6)}` : candidate;
  }

  /** Generates a one-time activation token for member self-claim onboarding. */
  async generateClaimToken(id: string, gymId: string, user?: CurrentUserPayload) {
    const member = await this.findOne(id, gymId, user);
    if (member.userId) {
      const user = await this.prisma.user.findUnique({ where: { id: member.userId } });
      if (user && user.status === UserStatus.ACTIVE && user.password) {
        throw new BadRequestException('This member already has an active account linked.');
      }
    }

    const rawToken = randomBytes(24).toString('hex');
    const tokenHash = this.encryption.hash(rawToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await this.prisma.member.update({
      where: { id: member.id },
      data: {
        claimToken: tokenHash,
        claimTokenExpiresAt: expiresAt,
      },
    });

    await this.audit.log({
      action: 'CLAIM_TOKEN_GENERATED',
      entity: 'Member',
      entityId: member.id,
      gymId,
    });

    return {
      memberId: member.id,
      token: rawToken,
      expiresAt,
      claimUrl: `/claim?token=${rawToken}`,
    };
  }

  /** Lists all members in PENDING status awaiting review/approval by owner or staff. */
  async findPendingRegistrations(gymId: string, user?: CurrentUserPayload) {
    const where: any = {
      gymId,
      deletedAt: null,
      OR: [
        { registrationStatus: 'PENDING' },
        { status: UserStatus.PENDING },
      ],
    };
    if (this.accessScope?.isBranchScoped(user)) {
      where.branchId = user!.branchId;
    }
    return this.prisma.member.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        batch: { select: { id: true, name: true, startTime: true, endTime: true } },
        trainer: { select: { id: true, firstName: true, lastName: true } },
        currentMembership: { select: { id: true, planName: true, status: true, startDate: true, endDate: true } },
      },
    });
  }

  /** Approves a pending self-registration, optionally assigning/changing their batch, and activates their trial membership. */
  async approveRegistration(id: string, gymId: string, batchId?: string, reviewerId?: string, user?: CurrentUserPayload) {
    const member = await this.prisma.member.findFirst({
      where: { id, gymId, deletedAt: null },
      include: { currentMembership: true },
    });
    if (!member) throw new NotFoundException('Member not found');
    if (this.accessScope && user) {
      this.accessScope.assertBranchAccess(user, member.branchId);
    }
    if (member.status !== UserStatus.PENDING && (member as any).registrationStatus !== 'PENDING') {
      throw new BadRequestException(`Member is not in PENDING status (current: ${member.status})`);
    }

    const finalBatchId = batchId || member.batchId;
    if (batchId) {
      const b = await this.prisma.batch.findFirst({ where: { id: batchId, gymId, deletedAt: null } });
      if (!b) throw new BadRequestException('Specified batch does not exist in this gym');
    }

    return this.prisma.$transaction(async (tx) => {
      if (finalBatchId) {
        const batch = await tx.batch.findUnique({ where: { id: finalBatchId } });
        if (batch) {
          const currentCount = await tx.member.count({
            where: { batchId: finalBatchId, deletedAt: null, registrationStatus: 'APPROVED' },
          });
          if (currentCount >= batch.capacity) {
            throw new ConflictException(`Batch "${batch.name}" has reached maximum capacity (${batch.capacity}).`);
          }
        }
      }

      const updated = await tx.member.update({
        where: { id },
        data: {
          status: UserStatus.ACTIVE,
          registrationStatus: 'APPROVED' as any,
          approvedAt: new Date(),
          approvedBy: reviewerId,
          ...(finalBatchId ? { batchId: finalBatchId } : {}),
        },
        include: {
          batch: true,
          currentMembership: true,
        },
      });

      if (member.currentMembershipId && member.currentMembership?.status === MembershipStatus.PENDING) {
        await tx.membership.update({
          where: { id: member.currentMembershipId },
          data: { status: MembershipStatus.ACTIVE },
        });
      }

      await this.audit.log({
        action: 'MEMBER_REGISTRATION_APPROVED',
        entity: 'Member',
        entityId: id,
        userId: reviewerId,
        gymId,
        newValue: { status: UserStatus.ACTIVE, registrationStatus: 'APPROVED', batchId: finalBatchId },
      });

      return updated;
    });
  }

  /** Rejects a pending self-registration, marking the profile INACTIVE and cancelling any pending membership. */
  async rejectRegistration(id: string, gymId: string, reason?: string, reviewerId?: string, user?: CurrentUserPayload) {
    const member = await this.prisma.member.findFirst({
      where: { id, gymId, deletedAt: null },
    });
    if (!member) throw new NotFoundException('Member not found');
    if (this.accessScope && user) {
      this.accessScope.assertBranchAccess(user, member.branchId);
    }
    if (member.status !== UserStatus.PENDING && (member as any).registrationStatus !== 'PENDING') {
      throw new BadRequestException(`Member is not in PENDING status (current: ${member.status})`);
    }

    const updated = await this.prisma.member.update({
      where: { id },
      data: {
        status: UserStatus.INACTIVE,
        registrationStatus: 'REJECTED' as any,
        rejectedAt: new Date(),
        rejectedBy: reviewerId,
        rejectionReason: reason,
      },
    });

    if (member.currentMembershipId) {
      await this.prisma.membership.update({
        where: { id: member.currentMembershipId },
        data: { status: MembershipStatus.CANCELLED },
      });
    }

    await this.audit.log({
      action: 'MEMBER_REGISTRATION_REJECTED',
      entity: 'Member',
      entityId: id,
      userId: reviewerId,
      gymId,
      newValue: { status: UserStatus.INACTIVE, registrationStatus: 'REJECTED', reason },
    });

    return updated;
  }

  /** Assigns or updates a member's batch. */
  async assignBatch(id: string, gymId: string, batchId: string, reviewerId?: string, user?: CurrentUserPayload) {
    const member = await this.prisma.member.findFirst({
      where: { id, gymId, deletedAt: null },
    });
    if (!member) throw new NotFoundException('Member not found');
    if (this.accessScope && user) {
      this.accessScope.assertBranchAccess(user, member.branchId);
    }

    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.batch.findFirst({
        where: { id: batchId, gymId, deletedAt: null },
      });
      if (!batch) throw new BadRequestException('Batch does not exist in this gym');

      const currentCount = await tx.member.count({
        where: { batchId, deletedAt: null, registrationStatus: 'APPROVED' },
      });
      if (currentCount >= batch.capacity) {
        throw new ConflictException(`Batch "${batch.name}" has reached maximum capacity (${batch.capacity}).`);
      }

      const updated = await tx.member.update({
        where: { id },
        data: { batchId },
        include: { batch: true },
      });

      await this.audit.log({
        action: 'MEMBER_BATCH_ASSIGNED',
        entity: 'Member',
        entityId: id,
        userId: reviewerId,
        gymId,
        newValue: { batchId, batchName: batch.name },
      });

      return updated;
    });
  }
}
