import { randomUUID, randomBytes } from 'crypto';

import { PrismaService } from '@database/prisma.service';
import { Injectable, NotFoundException, BadRequestException, ForbiddenException, ConflictException } from '@nestjs/common';
import { UserStatus, MembershipStatus, Prisma } from '@prisma/client';
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
  ) {}

  async findAll(gymId: string, query: QueryMemberDto) {
    const { page = 1, limit = 20, search, status, batchId, trainerId, expired } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.MemberWhereInput = { gymId, deletedAt: null };
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
  async exportData(gymId: string, query: QueryMemberDto) {
    const { search, status, batchId, trainerId } = query;
    const where: Prisma.MemberWhereInput = { gymId, deletedAt: null };
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

  async findOne(id: string, gymId: string, requester?: { role?: string; permissions?: string[] }) {
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
  async getMember360(id: string, gymId: string, requester?: { role?: string; permissions?: string[] }) {
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

    const [attendance, payments, lastPayment, activeDietPlan, activeWorkoutPlan] = await Promise.all([
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
    ]);

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
      attendance,
      payments,
      activeDietPlan,
      activeWorkoutPlan,
    };
  }

  async create(gymId: string, dto: CreateMemberDto) {
    if (dto.mobile) {
      const duplicate = await this.prisma.member.findFirst({
        where: { gymId, mobile: dto.mobile, deletedAt: null },
      });
      if (duplicate) throw new BadRequestException('A member with this mobile number already exists');
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

  async update(id: string, gymId: string, dto: UpdateMemberDto) {
    const existing = await this.findOne(id, gymId);

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

    if (dto.mobile && dto.mobile !== existing.mobile) {
      const duplicate = await this.prisma.member.findFirst({
        where: { gymId, mobile: dto.mobile, deletedAt: null, id: { not: id } },
      });
      if (duplicate) throw new BadRequestException('A member with this mobile number already exists');
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
  async deactivate(id: string, gymId: string, reason?: string) {
    await this.findOne(id, gymId);
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

  async reactivate(id: string, gymId: string) {
    await this.findOne(id, gymId);
    const member = await this.prisma.member.update({
      where: { id },
      data: { status: UserStatus.ACTIVE },
    });
    await this.audit.log({ action: 'REACTIVATE', entity: 'Member', entityId: id, gymId });
    return member;
  }

  /** Soft delete — keeps attendance/payment history intact for reporting/audit purposes. */
  async remove(id: string, gymId: string) {
    const existing = await this.findOne(id, gymId);
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
  async regenerateQr(id: string, gymId: string) {
    await this.findOne(id, gymId);
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
  async generateClaimToken(id: string, gymId: string) {
    const member = await this.findOne(id, gymId);
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
  async findPendingRegistrations(gymId: string) {
    return this.prisma.member.findMany({
      where: { gymId, status: UserStatus.PENDING, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        batch: { select: { id: true, name: true, startTime: true, endTime: true } },
        trainer: { select: { id: true, firstName: true, lastName: true } },
        currentMembership: { select: { id: true, planName: true, status: true, startDate: true, endDate: true } },
      },
    });
  }

  /** Approves a pending self-registration, optionally assigning/changing their batch, and activates their trial membership. */
  async approveRegistration(id: string, gymId: string, batchId?: string, reviewerId?: string) {
    const member = await this.prisma.member.findFirst({
      where: { id, gymId, deletedAt: null },
      include: { currentMembership: true },
    });
    if (!member) throw new NotFoundException('Member not found');
    if (member.status !== UserStatus.PENDING) {
      throw new BadRequestException(`Member is not in PENDING status (current: ${member.status})`);
    }

    const finalBatchId = batchId || member.batchId;
    if (batchId) {
      const b = await this.prisma.batch.findFirst({ where: { id: batchId, gymId, deletedAt: null } });
      if (!b) throw new BadRequestException('Specified batch does not exist in this gym');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.member.update({
        where: { id },
        data: {
          status: UserStatus.ACTIVE,
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
        newValue: { status: UserStatus.ACTIVE, batchId: finalBatchId },
      });

      return updated;
    });
  }

  /** Rejects a pending self-registration, marking the profile INACTIVE and cancelling any pending membership. */
  async rejectRegistration(id: string, gymId: string, reason?: string, reviewerId?: string) {
    const member = await this.prisma.member.findFirst({
      where: { id, gymId, deletedAt: null },
    });
    if (!member) throw new NotFoundException('Member not found');
    if (member.status !== UserStatus.PENDING) {
      throw new BadRequestException(`Member is not in PENDING status (current: ${member.status})`);
    }

    const updated = await this.prisma.member.update({
      where: { id },
      data: {
        status: UserStatus.INACTIVE,
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
      newValue: { status: UserStatus.INACTIVE, reason },
    });

    return updated;
  }

  /** Assigns or updates a member's batch. */
  async assignBatch(id: string, gymId: string, batchId: string, reviewerId?: string) {
    const member = await this.prisma.member.findFirst({
      where: { id, gymId, deletedAt: null },
    });
    if (!member) throw new NotFoundException('Member not found');

    const batch = await this.prisma.batch.findFirst({
      where: { id: batchId, gymId, deletedAt: null },
    });
    if (!batch) throw new BadRequestException('Batch does not exist in this gym');

    const updated = await this.prisma.member.update({
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
  }
}
