import * as crypto from 'crypto';

import { PrismaService } from '@database/prisma.service';
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { UserRole, UserStatus, Prisma } from '@prisma/client';
import { AuditService } from '@shared/services/audit.service';
import * as bcrypt from 'bcryptjs';

import { CreateStaffDto, UpdateStaffDto, QueryStaffDto, STAFF_ROLES } from './dto';


@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(gymId: string, query: QueryStaffDto) {
    const { page = 1, limit = 20, search, role, status } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.UserWhereInput = {
      gymId,
      deletedAt: null,
      role: { in: STAFF_ROLES as unknown as UserRole[] },
    };
    if (role) where.role = role;
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, firstName: true, lastName: true, email: true, phone: true,
          role: true, status: true, avatar: true, lastLoginAt: true, createdAt: true,
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(id: string, gymId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, gymId, deletedAt: null, role: { in: STAFF_ROLES as unknown as UserRole[] } },
      select: {
        id: true, firstName: true, lastName: true, email: true, phone: true,
        role: true, status: true, avatar: true, lastLoginAt: true, createdAt: true,
      },
    });
    if (!user) throw new NotFoundException('Staff member not found');
    return user;
  }

  /** Gym Owner creates a Trainer/Receptionist account — active immediately, temp password returned once. */
  async create(gymId: string, dto: CreateStaffDto, createdBy: string) {
    const existing = await this.prisma.user.findFirst({ where: { email: dto.email, gymId } });
    if (existing) throw new BadRequestException('A staff account with this email already exists in this gym');

    const tempPassword = crypto.randomBytes(6).toString('base64url'); // e.g. "aZ3kQ1mN"
    const hashedPassword = await bcrypt.hash(tempPassword, 12);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        password: hashedPassword,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        role: dto.role,
        status: UserStatus.ACTIVE,
        emailVerified: false,
        gymId,
        branchId: dto.branchId,
      },
    });

    await this.audit.log({
      action: 'STAFF_CREATED', entity: 'User', entityId: user.id, userId: createdBy, gymId,
      newValue: { email: user.email, role: user.role },
    });

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      tempPassword,
      message: 'Staff account created. Share this temporary password securely — it will not be shown again.',
    };
  }

  async update(id: string, gymId: string, dto: UpdateStaffDto, updatedBy: string) {
    const existing = await this.findOne(id, gymId);
    const user = await this.prisma.user.update({ where: { id }, data: dto });
    await this.audit.log({
      action: 'STAFF_UPDATED', entity: 'User', entityId: id, userId: updatedBy, gymId,
      oldValue: existing, newValue: { firstName: user.firstName, lastName: user.lastName, role: user.role },
    });
    return this.findOne(id, gymId);
  }

  async deactivate(id: string, gymId: string, actorId: string) {
    await this.findOne(id, gymId);
    await this.prisma.user.update({ where: { id }, data: { status: UserStatus.INACTIVE } });
    await this.prisma.refreshToken.updateMany({ where: { userId: id }, data: { revokedAt: new Date() } });
    await this.prisma.userSession.updateMany({ where: { userId: id }, data: { isActive: false } });
    await this.audit.log({ action: 'STAFF_DEACTIVATED', entity: 'User', entityId: id, userId: actorId, gymId });
    return { message: 'Staff account deactivated and all sessions revoked' };
  }

  async reactivate(id: string, gymId: string, actorId: string) {
    await this.findOne(id, gymId);
    await this.prisma.user.update({ where: { id }, data: { status: UserStatus.ACTIVE } });
    await this.audit.log({ action: 'STAFF_REACTIVATED', entity: 'User', entityId: id, userId: actorId, gymId });
    return { message: 'Staff account reactivated' };
  }

  /** Admin-triggered password reset — generates a new temp password (no email dependency). */
  async resetPassword(id: string, gymId: string, actorId: string) {
    await this.findOne(id, gymId);
    const tempPassword = crypto.randomBytes(6).toString('base64url');
    const hashedPassword = await bcrypt.hash(tempPassword, 12);
    await this.prisma.user.update({ where: { id }, data: { password: hashedPassword, loginAttempts: 0, lockedUntil: null } });
    await this.prisma.refreshToken.updateMany({ where: { userId: id }, data: { revokedAt: new Date() } });
    await this.audit.log({ action: 'STAFF_PASSWORD_RESET', entity: 'User', entityId: id, userId: actorId, gymId });
    return { tempPassword, message: 'Password reset. Share the new temporary password securely.' };
  }

  async remove(id: string, gymId: string, actorId: string) {
    const existing = await this.findOne(id, gymId);
    await this.prisma.user.update({ where: { id }, data: { deletedAt: new Date(), status: UserStatus.INACTIVE } });
    await this.audit.log({ action: 'STAFF_DELETED', entity: 'User', entityId: id, userId: actorId, gymId, oldValue: existing });
    return { message: 'Staff account removed' };
  }
}
