import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { AuditService } from '@shared/services/audit.service';

import { CreateBranchDto, UpdateBranchDto } from './dto';

@Injectable()
export class BranchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(gymId: string, dto: CreateBranchDto, userId: string) {
    if ((dto.latitude == null) !== (dto.longitude == null)) {
      throw new BadRequestException('latitude and longitude must be provided together');
    }
    if (dto.geofenceRadiusMeters != null && dto.latitude == null) {
      throw new BadRequestException('geofenceRadiusMeters requires latitude/longitude to be set');
    }

    const branch = await this.prisma.branch.create({
      data: { ...dto, gymId },
    });

    await this.audit.log({
      action: 'BRANCH_CREATED',
      entity: 'Branch',
      entityId: branch.id,
      newValue: { name: branch.name, gymId },
      userId,
      gymId,
    });

    return branch;
  }

  async findAll(gymId: string) {
    return this.prisma.branch.findMany({
      where: { gymId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { members: true } } },
    });
  }

  async findOne(gymId: string, id: string) {
    const branch = await this.prisma.branch.findFirst({ where: { id, gymId, deletedAt: null } });
    if (!branch) throw new NotFoundException('Branch not found');
    return branch;
  }

  async update(gymId: string, id: string, dto: UpdateBranchDto, userId: string) {
    const existing = await this.findOne(gymId, id);

    const nextLat = dto.latitude ?? existing.latitude;
    const nextLng = dto.longitude ?? existing.longitude;
    if ((nextLat == null) !== (nextLng == null)) {
      throw new BadRequestException('latitude and longitude must be provided together');
    }
    const nextRadius = dto.geofenceRadiusMeters ?? existing.geofenceRadiusMeters;
    if (nextRadius != null && nextLat == null) {
      throw new BadRequestException('geofenceRadiusMeters requires latitude/longitude to be set');
    }

    const branch = await this.prisma.branch.update({ where: { id }, data: dto });

    await this.audit.log({
      action: 'BRANCH_UPDATED',
      entity: 'Branch',
      entityId: id,
      oldValue: { name: existing.name, latitude: existing.latitude, longitude: existing.longitude, geofenceRadiusMeters: existing.geofenceRadiusMeters },
      newValue: dto,
      userId,
      gymId,
    });

    return branch;
  }

  /** Soft delete only — never hard-delete a branch with attendance/membership history. */
  async remove(gymId: string, id: string, userId: string) {
    const existing = await this.findOne(gymId, id);
    await this.prisma.branch.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    // Also revoke any live QR so a deleted branch can't still accept check-ins.
    await this.prisma.branchQrToken.updateMany({
      where: { branchId: id, isActive: true },
      data: { isActive: false, revokedAt: new Date() },
    });

    await this.audit.log({
      action: 'BRANCH_DELETED',
      entity: 'Branch',
      entityId: id,
      oldValue: { name: existing.name },
      userId,
      gymId,
    });

    return { deleted: true };
  }
}
