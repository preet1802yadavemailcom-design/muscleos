import * as crypto from 'crypto';

import { PrismaService } from '@database/prisma.service';
import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '@shared/services/audit.service';
import { EncryptionService } from '@shared/services/encryption.service';
import archiver from 'archiver';

import { UpsertSettingDto, BulkUpsertSettingsDto } from './dto/upsert-setting.dto';

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly encryption: EncryptionService,
  ) {}

  // ---------- Key/value settings (business, tax, invoice, working hours, permissions, security) ----------

  async getAll(gymId: string) {
    const rows = await this.prisma.gymSetting.findMany({ where: { gymId } });
    const grouped: Record<string, Record<string, any>> = {};
    for (const row of rows) {
      grouped[row.category] ??= {};
      grouped[row.category][row.key] = this.cast(row.value, row.dataType);
    }
    return grouped;
  }

  async getCategory(gymId: string, category: string) {
    const rows = await this.prisma.gymSetting.findMany({ where: { gymId, category } });
    const result: Record<string, any> = {};
    for (const row of rows) result[row.key] = this.cast(row.value, row.dataType);
    return result;
  }

  async upsert(gymId: string, dto: UpsertSettingDto, userId?: string) {
    const setting = await this.prisma.gymSetting.upsert({
      where: { gymId_category_key: { gymId, category: dto.category, key: dto.key } },
      create: { gymId, category: dto.category, key: dto.key, value: dto.value, dataType: dto.dataType ?? 'string' },
      update: { value: dto.value, dataType: dto.dataType ?? 'string' },
    });

    await this.audit.log({
      action: 'UPDATE',
      entity: 'GymSetting',
      entityId: setting.id,
      newValue: { category: dto.category, key: dto.key, value: dto.value },
      gymId,
      userId,
    });

    return setting;
  }

  async bulkUpsert(gymId: string, dto: BulkUpsertSettingsDto, userId?: string) {
    const results = [];
    for (const setting of dto.settings) {
      results.push(await this.upsert(gymId, setting, userId));
    }
    return results;
  }

  async remove(gymId: string, category: string, key: string) {
    const existing = await this.prisma.gymSetting.findUnique({
      where: { gymId_category_key: { gymId, category, key } },
    });
    if (!existing) throw new NotFoundException('Setting not found');
    await this.prisma.gymSetting.delete({ where: { id: existing.id } });
    await this.audit.log({ action: 'DELETE', entity: 'GymSetting', entityId: existing.id, oldValue: existing, gymId });
    return { message: 'Setting deleted successfully' };
  }

  private cast(value: string, dataType: string) {
    switch (dataType) {
      case 'number':
        return Number(value);
      case 'boolean':
        return value === 'true';
      case 'json':
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      default:
        return value;
    }
  }

  // ---------- API keys (used for gateway webhooks / external integrations) ----------

  async generateApiKey(gymId: string, label: string, userId?: string) {
    const rawKey = `mos_${crypto.randomBytes(24).toString('hex')}`;
    const hashed = crypto.createHash('sha256').update(rawKey).digest('hex');

    await this.upsert(gymId, { category: 'api_keys', key: hashed, value: JSON.stringify({ label, createdAt: new Date() }), dataType: 'json' }, userId);

    // The raw key is returned exactly once — only the hash is persisted.
    return { apiKey: rawKey, label, message: 'Store this key securely — it will not be shown again.' };
  }

  async listApiKeys(gymId: string) {
    const rows = await this.prisma.gymSetting.findMany({ where: { gymId, category: 'api_keys' } });
    return rows.map((r) => ({ id: r.id, ...JSON.parse(r.value), keyHashPreview: r.key.slice(0, 8) + '…' }));
  }

  async revokeApiKey(gymId: string, keyHash: string, userId?: string) {
    return this.remove(gymId, 'api_keys', keyHash).then(async (res) => {
      await this.audit.log({ action: 'REVOKE', entity: 'ApiKey', gymId, userId });
      return res;
    });
  }

  // ---------- Backup / restore ----------

  /** Exports every gym-scoped table as a single JSON payload, zipped for download. */
  async createBackup(gymId: string): Promise<Buffer> {
    const [gym, members, batches, memberships, payments, attendance, settings, plans] = await Promise.all([
      this.prisma.gym.findUnique({ where: { id: gymId } }),
      this.prisma.member.findMany({ where: { gymId } }),
      this.prisma.batch.findMany({ where: { gymId } }),
      this.prisma.membership.findMany({ where: { gymId } }),
      this.prisma.payment.findMany({ where: { gymId } }),
      this.prisma.attendance.findMany({ where: { gymId } }),
      this.prisma.gymSetting.findMany({ where: { gymId, category: { not: 'api_keys' } } }),
      this.prisma.gymPlan.findMany(),
    ]);

    const payload = {
      exportedAt: new Date().toISOString(),
      version: 1,
      gym,
      members,
      batches,
      memberships,
      payments,
      attendance,
      settings,
      plans,
    };

    return new Promise((resolve, reject) => {
      const archive = archiver('zip', { zlib: { level: 9 } });
      const chunks: Buffer[] = [];
      archive.on('data', (chunk) => chunks.push(chunk));
      archive.on('end', () => resolve(Buffer.concat(chunks)));
      archive.on('error', reject);
      archive.append(JSON.stringify(payload, null, 2), { name: 'muscleos-backup.json' });
      archive.finalize();
    });
  }

  /**
   * Restores non-destructive, additive data from a previously exported backup JSON.
   * Existing records are matched by id and skipped to avoid clobbering live data —
   * this is intended for migrating into a fresh gym, not for point-in-time rollback.
   */
  async restoreBackup(gymId: string, payload: any, userId?: string) {
    let restored = 0;
    if (Array.isArray(payload.settings)) {
      for (const s of payload.settings) {
        await this.upsert(gymId, { category: s.category, key: s.key, value: s.value, dataType: s.dataType }, userId);
        restored++;
      }
    }
    await this.audit.log({ action: 'RESTORE', entity: 'GymBackup', newValue: { restoredSettings: restored }, gymId, userId });
    return { message: `Restore complete. ${restored} settings restored.`, note: 'Members/payments/attendance require manual review before restore for data-integrity reasons.' };
  }
}
