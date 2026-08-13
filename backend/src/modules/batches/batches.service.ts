import { PrismaService } from '@database/prisma.service';
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { AuditService } from '@shared/services/audit.service';

import { CreateBatchDto, UpdateBatchDto, QueryBatchDto } from './dto';

const DAY_ORDER = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

@Injectable()
export class BatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Validate start/end ordering and normalize/validate day codes. */
  private validateTiming(startTime: string, endTime: string, days: string[]) {
    if (toMinutes(startTime) >= toMinutes(endTime)) {
      throw new BadRequestException('startTime must be before endTime');
    }
    const invalid = days.filter((d) => !DAY_ORDER.includes(d.toUpperCase()));
    if (invalid.length) {
      throw new BadRequestException(`Invalid day code(s): ${invalid.join(', ')}`);
    }
  }

  /**
   * Conflict = same trainer, same gym, overlapping day, overlapping time window.
   * excludeId lets update() ignore the batch being edited.
   */
  private async detectConflict(
    gymId: string,
    trainerId: string | undefined,
    startTime: string,
    endTime: string,
    days: string[],
    excludeId?: string,
  ) {
    if (!trainerId) return;
    const candidates = await this.prisma.batch.findMany({
      where: {
        gymId,
        trainerId,
        status: { not: 'ARCHIVED' as any },
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true, name: true, startTime: true, endTime: true, days: true },
    });

    const newStart = toMinutes(startTime);
    const newEnd = toMinutes(endTime);
    const normDays = days.map((d) => d.toUpperCase());

    for (const c of candidates) {
      const sharesDay = c.days.some((d) => normDays.includes(d.toUpperCase()));
      if (!sharesDay) continue;
      const cStart = toMinutes(c.startTime);
      const cEnd = toMinutes(c.endTime);
      const overlaps = newStart < cEnd && cStart < newEnd;
      if (overlaps) {
        throw new ConflictException(
          `Trainer already assigned to "${c.name}" (${c.startTime}-${c.endTime}) on overlapping day(s)`,
        );
      }
    }
  }

  async findAll(gymId: string, query: QueryBatchDto) {
    const { page = 1, limit = 20, search, type, status, trainerId, includeArchived } = query;
    const skip = (page - 1) * limit;
    const where: any = { gymId, deletedAt: includeArchived ? undefined : null };
    if (search) where.name = { contains: search, mode: 'insensitive' };
    if (type) where.type = type;
    if (status) where.status = status;
    if (trainerId) where.trainerId = trainerId;

    const [data, total] = await Promise.all([
      this.prisma.batch.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          trainer: { select: { id: true, firstName: true, lastName: true } },
          _count: { select: { members: true } },
        },
      }),
      this.prisma.batch.count({ where }),
    ]);

    return {
      data: data.map((b) => ({
        ...b,
        seatsTaken: b._count.members,
        seatsAvailable: Math.max(b.capacity - b._count.members, 0),
      })),
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

  async findOne(id: string, gymId: string) {
    const item = await this.prisma.batch.findFirst({
      where: { id, gymId },
      include: {
        trainer: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { members: true } },
      },
    });
    if (!item) throw new NotFoundException('Batch not found');
    return item;
  }

  async create(gymId: string, dto: CreateBatchDto) {
    this.validateTiming(dto.startTime, dto.endTime, dto.days);
    await this.detectConflict(gymId, dto.trainerId, dto.startTime, dto.endTime, dto.days);

    const item = await this.prisma.batch.create({
      data: { ...dto, gymId, days: dto.days.map((d) => d.toUpperCase()) },
    });
    await this.audit.log({
      action: 'CREATE',
      entity: 'Batch',
      entityId: item.id,
      newValue: item,
      gymId,
    });
    return item;
  }

  async update(id: string, gymId: string, dto: UpdateBatchDto) {
    const existing = await this.findOne(id, gymId);

    const startTime = dto.startTime ?? existing.startTime;
    const endTime = dto.endTime ?? existing.endTime;
    const days = dto.days ?? existing.days;
    const trainerId = dto.trainerId !== undefined ? dto.trainerId : existing.trainerId;

    if (dto.startTime || dto.endTime || dto.days) {
      this.validateTiming(startTime, endTime, days);
    }
    if (dto.trainerId !== undefined || dto.startTime || dto.endTime || dto.days) {
      await this.detectConflict(gymId, trainerId ?? undefined, startTime, endTime, days, id);
    }

    const { archived, ...rest } = dto;
    const item = await this.prisma.batch.update({
      where: { id },
      data: {
        ...rest,
        ...(dto.days ? { days: dto.days.map((d) => d.toUpperCase()) } : {}),
        ...(archived !== undefined
          ? { status: archived ? 'ARCHIVED' : 'ACTIVE', deletedAt: archived ? new Date() : null }
          : {}),
      },
    });
    await this.audit.log({
      action: 'UPDATE',
      entity: 'Batch',
      entityId: id,
      oldValue: existing,
      newValue: item,
      gymId,
    });
    return item;
  }

  async remove(id: string, gymId: string) {
    const existing = await this.findOne(id, gymId);
    await this.prisma.batch.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'ARCHIVED' as any },
    });
    await this.audit.log({
      action: 'DELETE',
      entity: 'Batch',
      entityId: id,
      oldValue: existing,
      gymId,
    });
    return { message: 'Batch archived successfully' };
  }

  /** Batch-level analytics: members, seat utilization, attendance %, revenue. */
  async analytics(id: string, gymId: string, from?: Date, to?: Date) {
    const batch = await this.findOne(id, gymId);
    const range = {
      gte: from ?? new Date(new Date().setDate(new Date().getDate() - 30)),
      lte: to ?? new Date(),
    };

    const [memberCount, attendanceCount, expectedSessions, revenueAgg] = await Promise.all([
      this.prisma.member.count({ where: { batchId: id, gymId } }),
      this.prisma.attendance.count({
        where: { batchId: id, gymId, checkInAt: range },
      }),
      this.sessionsInRange(batch.days, range.gte, range.lte),
      this.prisma.payment.aggregate({
        where: { member: { batchId: id }, gymId, status: 'COMPLETED' as any, createdAt: range },
        _sum: { total: true },
      }),
    ]);

    const expectedAttendance = expectedSessions * memberCount;
    const attendancePct = expectedAttendance > 0
      ? Math.round((attendanceCount / expectedAttendance) * 10000) / 100
      : 0;

    return {
      batchId: id,
      name: batch.name,
      capacity: batch.capacity,
      membersEnrolled: memberCount,
      seatsAvailable: Math.max(batch.capacity - memberCount, 0),
      utilizationPct: Math.round((memberCount / batch.capacity) * 10000) / 100,
      attendancePct,
      revenueCollected: revenueAgg._sum.total ?? 0,
      periodFrom: range.gte,
      periodTo: range.lte,
    };
  }

  private sessionsInRange(days: string[], from: Date, to: Date): number {
    let count = 0;
    const cur = new Date(from);
    const targetDays = new Set(days.map((d) => d.toUpperCase()));
    while (cur <= to) {
      const code = DAY_ORDER[(cur.getDay() + 6) % 7]; // JS Sunday=0 -> map to MON..SUN
      if (targetDays.has(code)) count++;
      cur.setDate(cur.getDate() + 1);
    }
    return count;
  }

  /** Calendar view: sessions for a given month, expanded from weekly recurrence. */
  async calendar(gymId: string, year: number, month: number) {
    const batches = await this.prisma.batch.findMany({
      where: { gymId, deletedAt: null, status: { not: 'ARCHIVED' as any } },
      select: { id: true, name: true, startTime: true, endTime: true, days: true, trainerId: true },
    });

    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0);
    const sessions: any[] = [];

    for (const cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
      const code = DAY_ORDER[(cur.getDay() + 6) % 7];
      for (const b of batches) {
        if (b.days.map((d) => d.toUpperCase()).includes(code)) {
          sessions.push({
            date: new Date(cur),
            batchId: b.id,
            name: b.name,
            startTime: b.startTime,
            endTime: b.endTime,
          });
        }
      }
    }
    return sessions;
  }

  /** History/audit trail for a batch. */
  async history(id: string, gymId: string) {
    await this.findOne(id, gymId); // 404 if not found/not in gym
    return this.prisma.auditLog.findMany({
      where: { entity: 'Batch', entityId: id, gymId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Export batch list as rows ready for PDF/Excel generation in the export service. */
  async exportData(gymId: string, query: QueryBatchDto) {
    const { data } = await this.findAll(gymId, { ...query, page: 1, limit: 10000 });
    return data.map((b) => ({
      Name: b.name,
      Type: b.type,
      Timing: `${b.startTime}-${b.endTime}`,
      Days: b.days.join(', '),
      Trainer: b.trainer ? `${b.trainer.firstName} ${b.trainer.lastName}` : '-',
      Capacity: b.capacity,
      SeatsTaken: b.seatsTaken,
      Status: b.status,
    }));
  }
}
