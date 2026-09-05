import { randomBytes } from 'crypto';

import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '@database/prisma.service';
import { AuditService } from '@shared/services/audit.service';

/**
 * Permanent wall QR = a printable poster encoding ONLY this opaque token
 * (e.g. as a URL like https://app.muscleos.com/s/<token>). Unlike the old
 * `generateGymQRCodeData`/`decodeQRCodeData` approach — which re-derived the
 * gymId by decrypting with the app-wide JWT secret and therefore could
 * never be individually invalidated — every token here is a real DB row.
 * Revoking = flip `isActive` false + `revokedAt`; the poster instantly
 * stops working. Regenerating = revoke the old one, mint a new one; the
 * owner reprints, nothing else in the system needs to change.
 */
@Injectable()
export class QrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Single-branch-gym convenience path: most gyms starting out have one
   *  location, so don't force them through "create a branch" before they
   *  can get a QR at all. Auto-provisions a "Main Branch" (seeded from the
   *  gym's own address fields) the first time this is called, then behaves
   *  exactly like generateForBranch/resolveToken from then on — multi-branch
   *  orgs still use the real /branches endpoints for anything past this. */
  async getOrCreateDefaultBranchQr(gymId: string, userId: string) {
    let branch = await this.prisma.branch.findFirst({ where: { gymId, deletedAt: null }, orderBy: { createdAt: 'asc' } });
    if (!branch) {
      const gym = await this.prisma.gym.findUnique({ where: { id: gymId } });
      branch = await this.prisma.branch.create({
        data: {
          gymId,
          name: 'Main Branch',
          address: gym?.address, city: gym?.city, state: gym?.state, pincode: gym?.pincode,
          latitude: gym?.latitude, longitude: gym?.longitude,
        },
      });
    }

    const existing = await this.prisma.branchQrToken.findFirst({ where: { branchId: branch.id, isActive: true } });
    if (existing) {
      return { token: existing.token, branchId: branch.id, generatedAt: existing.createdAt };
    }
    return this.generateForBranch(branch.id, gymId, userId);
  }

  async generateForBranch(branchId: string, gymId: string, createdByUserId: string) {
    const branch = await this.assertBranchOwnedByGym(branchId, gymId);

    // A branch should have at most one ACTIVE token at a time — revoke any
    // stragglers before minting (defensive; regenerate() is the normal path).
    await this.prisma.branchQrToken.updateMany({
      where: { branchId, isActive: true },
      data: { isActive: false, revokedAt: new Date() },
    });

    const token = await this.mintUniqueToken();
    const created = await this.prisma.branchQrToken.create({
      data: { branchId, token, createdBy: createdByUserId },
    });

    await this.audit.log({
      action: 'QR_GENERATED',
      entity: 'Branch',
      entityId: branch.id,
      userId: createdByUserId,
      gymId,
      newValue: { branchId, tokenId: created.id },
    });

    return { token: created.token, branchId, generatedAt: created.createdAt };
  }

  /** Revokes the current token and mints a fresh one — old printed QR stops working immediately. */
  async regenerate(branchId: string, gymId: string, userId: string) {
    return this.generateForBranch(branchId, gymId, userId);
  }

  async revoke(branchId: string, gymId: string, userId: string) {
    await this.assertBranchOwnedByGym(branchId, gymId);
    await this.prisma.branchQrToken.updateMany({
      where: { branchId, isActive: true },
      data: { isActive: false, revokedAt: new Date() },
    });
    await this.audit.log({
      action: 'QR_REVOKED', entity: 'Branch', entityId: branchId, userId, gymId,
    });
    return { revoked: true };
  }

  /**
   * Scan-time resolution: opaque token → active Branch + Gym, or throws.
   * No decryption, no embedded PII — a leaked/guessed token only ever
   * resolves to "which branch", never to any member or secret data.
   */
  async resolveToken(token: string) {
    const record = await this.prisma.branchQrToken.findUnique({
      where: { token },
      include: { branch: { include: { gym: true } } },
    });
    if (!record || !record.isActive) {
      throw new NotFoundException('QR code is invalid or has been revoked — ask staff for the current QR.');
    }
    if (!record.branch.isActive || record.branch.deletedAt) {
      throw new NotFoundException('This branch is not currently active.');
    }
    if (record.branch.gym.status !== 'ACTIVE' || record.branch.gym.deletedAt) {
      throw new ForbiddenException('This gym is not currently active.');
    }
    return { branch: record.branch, gym: record.branch.gym };
  }

  private async assertBranchOwnedByGym(branchId: string, gymId: string) {
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, gymId, deletedAt: null } });
    if (!branch) throw new NotFoundException('Branch not found');
    return branch;
  }

  /** base62, 20 chars — long enough that guessing is infeasible; opaque, no structure to reverse-engineer. */
  private async mintUniqueToken(): Promise<string> {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const bytes = randomBytes(20);
      let token = '';
      for (let i = 0; i < 20; i += 1) token += alphabet[bytes[i] % alphabet.length];
      // eslint-disable-next-line no-await-in-loop
      const clash = await this.prisma.branchQrToken.findUnique({ where: { token } });
      if (!clash) return token;
    }
    throw new Error('Could not generate a unique QR token — please retry.');
  }
}
