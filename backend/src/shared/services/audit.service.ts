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
      const sanitizedOld = data.oldValue ? this.redactSensitive(data.oldValue) : undefined;
      const sanitizedNew = data.newValue ? this.redactSensitive(data.newValue) : undefined;
      await this.prisma.auditLog.create({
        data: {
          action: data.action,
          entity: data.entity,
          entityId: data.entityId,
          oldValue: sanitizedOld ? JSON.stringify(sanitizedOld) : undefined,
          newValue: sanitizedNew ? JSON.stringify(sanitizedNew) : undefined,
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

  /** Transactional audit logging: ensures the audit record is committed atomically with the business mutation. */
  async logTx(tx: any, data: AuditLogData): Promise<void> {
    const sanitizedOld = data.oldValue ? this.redactSensitive(data.oldValue) : undefined;
    const sanitizedNew = data.newValue ? this.redactSensitive(data.newValue) : undefined;
    await tx.auditLog.create({
      data: {
        action: data.action,
        entity: data.entity,
        entityId: data.entityId,
        oldValue: sanitizedOld ? JSON.stringify(sanitizedOld) : undefined,
        newValue: sanitizedNew ? JSON.stringify(sanitizedNew) : undefined,
        userId: data.userId,
        gymId: data.gymId,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        endpoint: data.endpoint,
        method: data.method,
      },
    });
  }

  private redactSensitive(data: any): any {
    if (!data) return data;
    if (typeof data !== 'object') return data;
    if (Array.isArray(data)) return data.map((item) => this.redactSensitive(item));

    const sensitiveFields = new Set([
      'password',
      'currentPassword',
      'newPassword',
      'confirmPassword',
      'accessToken',
      'refreshToken',
      'token',
      'otp',
      'secret',
      'twoFactorSecret',
      'twoFactorRecoveryCodes',
      'claimToken',
      'qrCodeData',
    ]);

    const sanitized: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      if (sensitiveFields.has(key)) {
        sanitized[key] = '[REDACTED]';
      } else if (value && typeof value === 'object') {
        sanitized[key] = this.redactSensitive(value);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
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
