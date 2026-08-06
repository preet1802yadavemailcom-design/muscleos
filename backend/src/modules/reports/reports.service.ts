import { PrismaService } from '@database/prisma.service';
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { ReportType, ReportPeriod } from '@prisma/client';
import { AuditService } from '@shared/services/audit.service';
import { ExportService, ExportColumn } from '@shared/services/export.service';

interface DateRange {
  startDate: Date;
  endDate: Date;
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly exportService: ExportService,
  ) {}

  async findAll(
    gymId: string,
    options: { page: number; limit: number; type?: ReportType; period?: ReportPeriod },
  ) {
    const { page, limit, type, period } = options;
    const skip = (page - 1) * limit;
    const where: any = { gymId };
    if (type) where.type = type;
    if (period) where.period = period;

    const [data, total] = await Promise.all([
      this.prisma.report.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      this.prisma.report.count({ where }),
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

  async findOne(id: string, gymId: string) {
    const item = await this.prisma.report.findFirst({ where: { id, gymId } });
    if (!item) throw new NotFoundException('Report not found');
    return item;
  }

  async remove(id: string, gymId: string) {
    const existing = await this.findOne(id, gymId);
    await this.prisma.report.delete({ where: { id } });
    await this.audit.log({ action: 'DELETE', entity: 'Report', entityId: id, oldValue: existing, gymId });
    return { message: 'Report deleted successfully' };
  }

  resolveRange(period: ReportPeriod, startDate?: string, endDate?: string): DateRange {
    if (period === ReportPeriod.CUSTOM) {
      if (!startDate || !endDate) {
        throw new BadRequestException('startDate and endDate are required for CUSTOM period');
      }
      return { startDate: new Date(startDate), endDate: new Date(endDate) };
    }

    const now = new Date();
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);

    switch (period) {
      case ReportPeriod.DAILY:
        break;
      case ReportPeriod.WEEKLY:
        start.setDate(start.getDate() - start.getDay());
        break;
      case ReportPeriod.MONTHLY:
        start.setDate(1);
        break;
      case ReportPeriod.YEARLY:
        start.setMonth(0, 1);
        break;
    }
    return { startDate: start, endDate: end };
  }

  async generate(
    gymId: string,
    userId: string,
    type: ReportType,
    period: ReportPeriod,
    startDate?: string,
    endDate?: string,
  ) {
    const range = this.resolveRange(period, startDate, endDate);
    let data: any;
    let summary: Record<string, any>;

    switch (type) {
      case ReportType.ATTENDANCE:
        ({ data, summary } = await this.buildAttendanceReport(gymId, range));
        break;
      case ReportType.REVENUE:
        ({ data, summary } = await this.buildRevenueReport(gymId, range));
        break;
      case ReportType.MEMBER:
        ({ data, summary } = await this.buildMemberReport(gymId, range));
        break;
      case ReportType.TRAINER:
        ({ data, summary } = await this.buildTrainerReport(gymId, range));
        break;
      case ReportType.BATCH:
        ({ data, summary } = await this.buildBatchReport(gymId, range));
        break;
      case ReportType.MEMBERSHIP:
        ({ data, summary } = await this.buildMembershipReport(gymId, range));
        break;
      case ReportType.PAYMENT:
        ({ data, summary } = await this.buildRevenueReport(gymId, range));
        break;
      default:
        throw new BadRequestException(`Unsupported report type: ${type}`);
    }

    const report = await this.prisma.report.create({
      data: {
        type,
        period,
        startDate: range.startDate,
        endDate: range.endDate,
        data,
        summary,
        generatedBy: userId,
        gymId,
      },
    });

    await this.audit.log({
      action: 'GENERATE',
      entity: 'Report',
      entityId: report.id,
      newValue: { type, period },
      gymId,
      userId,
    });

    return report;
  }

  private async buildAttendanceReport(gymId: string, range: DateRange) {
    const records = await this.prisma.attendance.findMany({
      where: { gymId, checkInAt: { gte: range.startDate, lte: range.endDate } },
      include: {
        member: { select: { firstName: true, lastName: true, memberCode: true } },
        batch: { select: { name: true } },
      },
      orderBy: { checkInAt: 'desc' },
    });

    const totalVisits = records.length;
    const uniqueMembers = new Set(records.map((r) => r.memberId)).size;
    const lateCount = records.filter((r) => r.isLate).length;
    const withDuration = records.filter((r) => r.duration);
    const avgDurationMins =
      withDuration.reduce((sum, r) => sum + (r.duration || 0), 0) / (withDuration.length || 1);

    const byDay = new Map<string, number>();
    for (const r of records) {
      const key = r.checkInAt.toISOString().slice(0, 10);
      byDay.set(key, (byDay.get(key) || 0) + 1);
    }

    return {
      summary: {
        totalVisits,
        uniqueMembers,
        lateCount,
        avgDurationMins: Math.round(avgDurationMins),
      },
      data: {
        chart: Array.from(byDay.entries()).map(([date, count]) => ({ date, count })),
        rows: records.map((r) => ({
          member: `${r.member.firstName} ${r.member.lastName}`,
          memberCode: r.member.memberCode,
          batch: r.batch?.name ?? '-',
          checkInAt: r.checkInAt,
          checkOutAt: r.checkOutAt,
          durationMins: r.duration,
          status: r.status,
          isLate: r.isLate,
        })),
      },
    };
  }

  private async buildRevenueReport(gymId: string, range: DateRange) {
    const payments = await this.prisma.payment.findMany({
      where: { gymId, status: 'COMPLETED', createdAt: { gte: range.startDate, lte: range.endDate } },
      include: { member: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const totalRevenue = payments.reduce((sum, p) => sum + Number(p.total), 0);
    const totalDiscount = payments.reduce((sum, p) => sum + Number(p.discount), 0);
    const totalTax = payments.reduce((sum, p) => sum + Number(p.tax), 0);

    const byGateway = new Map<string, number>();
    const byDay = new Map<string, number>();
    for (const p of payments) {
      byGateway.set(p.gateway, (byGateway.get(p.gateway) || 0) + Number(p.total));
      const key = p.createdAt.toISOString().slice(0, 10);
      byDay.set(key, (byDay.get(key) || 0) + Number(p.total));
    }

    return {
      summary: {
        totalRevenue: Number(totalRevenue.toFixed(2)),
        totalDiscount: Number(totalDiscount.toFixed(2)),
        totalTax: Number(totalTax.toFixed(2)),
        transactionCount: payments.length,
        avgTransactionValue: payments.length ? Number((totalRevenue / payments.length).toFixed(2)) : 0,
      },
      data: {
        chart: Array.from(byDay.entries()).map(([date, amount]) => ({ date, amount })),
        byGateway: Array.from(byGateway.entries()).map(([gateway, amount]) => ({ gateway, amount })),
        rows: payments.map((p) => ({
          receiptNumber: p.receiptNumber,
          member: p.member ? `${p.member.firstName} ${p.member.lastName}` : '-',
          gateway: p.gateway,
          method: p.method,
          amount: Number(p.total),
          date: p.createdAt,
        })),
      },
    };
  }

  private async buildMemberReport(gymId: string, range: DateRange) {
    const [newMembers, totalActive, totalInactive, totalExpired] = await Promise.all([
      this.prisma.member.findMany({
        where: { gymId, joinDate: { gte: range.startDate, lte: range.endDate }, deletedAt: null },
      }),
      this.prisma.member.count({ where: { gymId, status: 'ACTIVE', deletedAt: null } }),
      this.prisma.member.count({ where: { gymId, status: 'INACTIVE', deletedAt: null } }),
      this.prisma.member.count({
        where: {
          gymId,
          status: 'ACTIVE',
          deletedAt: null,
          currentMembership: { is: { endDate: { lt: new Date() } } },
        },
      }),
    ]);

    return {
      summary: { newMembers: newMembers.length, totalActive, totalInactive, totalExpired },
      data: {
        rows: newMembers.map((m) => ({
          memberCode: m.memberCode,
          name: `${m.firstName} ${m.lastName}`,
          mobile: m.mobile,
          joinDate: m.joinDate,
          status: m.status,
        })),
      },
    };
  }

  private async buildTrainerReport(gymId: string, range: DateRange) {
    const trainers = await this.prisma.user.findMany({
      where: { gymId, role: 'TRAINER', deletedAt: null },
      include: {
        trainerBatches: {
          include: {
            members: true,
            attendance: { where: { checkInAt: { gte: range.startDate, lte: range.endDate } } },
          },
        },
      },
    });

    const rows = trainers.map((t) => {
      const batches = t.trainerBatches;
      const totalMembers = batches.reduce((sum, b) => sum + b.members.length, 0);
      const totalSessions = batches.reduce((sum, b) => sum + b.attendance.length, 0);
      return {
        trainer: `${t.firstName} ${t.lastName}`,
        batchCount: batches.length,
        totalMembers,
        totalSessions,
      };
    });

    return { summary: { totalTrainers: trainers.length }, data: { rows } };
  }

  private async buildBatchReport(gymId: string, range: DateRange) {
    const batches = await this.prisma.batch.findMany({
      where: { gymId, deletedAt: null },
      include: {
        members: true,
        trainer: { select: { firstName: true, lastName: true } },
        attendance: { where: { checkInAt: { gte: range.startDate, lte: range.endDate } } },
      },
    });

    const rows = batches.map((b) => ({
      name: b.name,
      type: b.type,
      trainer: b.trainer ? `${b.trainer.firstName} ${b.trainer.lastName}` : '-',
      capacity: b.capacity,
      enrolled: b.members.length,
      seatUtilizationPct: b.capacity ? Math.round((b.members.length / b.capacity) * 100) : 0,
      attendanceInPeriod: b.attendance.length,
      status: b.status,
    }));

    return { summary: { totalBatches: batches.length }, data: { rows } };
  }

  private async buildMembershipReport(gymId: string, range: DateRange) {
    const memberships = await this.prisma.membership.findMany({
      where: { gymId, createdAt: { gte: range.startDate, lte: range.endDate } },
      include: { member: { select: { firstName: true, lastName: true } } },
    });

    const expiringSoon = await this.prisma.membership.count({
      where: {
        gymId,
        status: 'ACTIVE',
        endDate: { gte: new Date(), lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
      },
    });

    const byPlan = new Map<string, number>();
    for (const m of memberships) {
      byPlan.set(m.plan, (byPlan.get(m.plan) || 0) + 1);
    }

    return {
      summary: {
        newMemberships: memberships.length,
        expiringSoon,
        totalValue: memberships.reduce((sum, m) => sum + Number(m.totalAmount), 0),
      },
      data: {
        byPlan: Array.from(byPlan.entries()).map(([plan, count]) => ({ plan, count })),
        rows: memberships.map((m) => ({
          member: `${m.member.firstName} ${m.member.lastName}`,
          plan: m.plan,
          startDate: m.startDate,
          endDate: m.endDate,
          amount: Number(m.totalAmount),
          status: m.status,
        })),
      },
    };
  }

  async exportReport(
    gymId: string,
    userId: string,
    type: ReportType,
    period: ReportPeriod,
    format: 'pdf' | 'excel' | 'csv',
    startDate?: string,
    endDate?: string,
  ): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    const report = await this.generate(gymId, userId, type, period, startDate, endDate);
    const rawData = report.data as { rows?: Record<string, any>[] } | null;
    const rows: Record<string, any>[] = rawData?.rows ?? [];
    const columns: ExportColumn[] = rows.length
      ? Object.keys(rows[0]).map((key) => ({ header: this.titleCase(key), key }))
      : [{ header: 'No Data', key: 'none' }];

    const baseName = `${type.toLowerCase()}-report-${period.toLowerCase()}-${Date.now()}`;

    if (format === 'excel') {
      const buffer = await this.exportService.toExcel(rows, columns, type);
      return {
        buffer,
        filename: `${baseName}.xlsx`,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
    }
    if (format === 'csv') {
      const buffer = await this.exportService.toCsv(rows, columns);
      return { buffer, filename: `${baseName}.csv`, contentType: 'text/csv' };
    }
    const summaryEntries = Object.entries(report.summary as Record<string, any>).map(([label, value]) => ({
      label: this.titleCase(label),
      value,
    }));
    const buffer = await this.exportService.toPdf({
      title: `${this.titleCase(type)} Report`,
      subtitle: `${period} — ${report.startDate.toDateString()} to ${report.endDate.toDateString()}`,
      columns,
      rows,
      summary: summaryEntries,
    });
    return { buffer, filename: `${baseName}.pdf`, contentType: 'application/pdf' };
  }

  private titleCase(str: string): string {
    return str.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()).trim();
  }
}
