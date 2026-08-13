import { PrismaService } from '@database/prisma.service';
import { Injectable } from '@nestjs/common';

import { LoggerService } from './logger.service';

interface AuditLogData {
  action: string;
  entity: string;
  entityId?: string;
  oldValue?: any;
  newValue?: any;
  userId?: string;
  gymId?: string; // null for platform-level (Super Admin) actions
  ipAddress?: string;
  userAgent?: string;
  endpoint?: string;
  method?: string;
}

@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService,
  ) {}

  async log(data: AuditLogData): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action: data.action,
          entity: data.entity,
          entityId: data.entityId,
          oldValue: data.oldValue ? JSON.stringify(data.oldValue) : undefined,
          newValue: data.newValue ? JSON.stringify(data.newValue) : undefined,
          userId: data.userId,
          gymId: data.gymId,
          ipAddress: data.ipAddress,
          userAgent: data.userAgent,
          endpoint: data.endpoint,
          method: data.method,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to create audit log: ${error.message}`, error.stack, 'AuditService');
    }
  }

  async getAuditLogs(gymId: string | null, options: {
    action?: string;
    entity?: string;
    userId?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  } = {}) {
    const { action, entity, userId, startDate, endDate, limit = 50, offset = 0 } = options;
    // gymId === null means Super Admin viewing platform-wide logs (no tenant filter)
    const where: any = gymId ? { gymId } : {};
    if (action) where.action = action;
    if (entity) where.entity = entity;
    if (userId) where.userId = userId;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = startDate;
      if (endDate) where.createdAt.lte = endDate;
    }

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: {
          user: {
            select: { firstName: true, lastName: true, email: true, role: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { logs, total, limit, offset };
  }
}
