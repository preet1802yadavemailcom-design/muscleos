import { randomBytes } from 'crypto';

import { Injectable, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { authenticator } from 'otplib';
import * as qrcode from 'qrcode';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '@database/prisma.service';
import { AuditService } from '@shared/services/audit.service';

const RECOVERY_CODE_COUNT = 10;

@Injectable()
export class TwoFactorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Step 1 of setup: generate a secret + otpauth QR, NOT yet persisted as enabled.
   *  The secret is stored immediately (so a refresh doesn't lose it) but
   *  `twoFactorEnabled` stays false until `confirmSetup` verifies a real code —
   *  this proves the user's authenticator app actually works before we lock
   *  them into requiring it. */
  async beginSetup(userId: string, email: string) {
    const secret = authenticator.generateSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorSecret: secret, twoFactorEnabled: false },
    });
    const otpauth = authenticator.keyuri(email, 'MuscleOS', secret);
    const qrDataUrl = await qrcode.toDataURL(otpauth);
    return { secret, qrDataUrl };
  }

  /** Step 2 of setup: user submits a live code from their app to prove it's wired up correctly. */
  async confirmSetup(userId: string, code: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.twoFactorSecret) throw new BadRequestException('2FA setup has not been started');
    if (!authenticator.check(code, user.twoFactorSecret)) {
      throw new BadRequestException('Invalid code — please try again');
    }

    const recoveryCodes = await this.generateRecoveryCodes();
    const hashed = await Promise.all(recoveryCodes.map((c) => bcrypt.hash(c, 10)));
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: true, twoFactorRecoveryCodes: hashed },
    });

    await this.audit.log({
      action: 'ADMIN_2FA_ENABLED', entity: 'User', entityId: userId, userId, gymId: user.gymId ?? undefined,
    });

    // Recovery codes are shown to the user exactly once, here — never retrievable again.
    return { recoveryCodes };
  }

  async disable(userId: string, currentPasswordVerified: boolean) {
    if (!currentPasswordVerified) {
      throw new UnauthorizedException('Password confirmation required to disable 2FA');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user?.role === 'SUPER_ADMIN') {
      throw new BadRequestException('2FA is mandatory for Super Admin accounts and cannot be disabled');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorRecoveryCodes: [] },
    });
    await this.audit.log({ action: 'ADMIN_2FA_DISABLED', entity: 'User', entityId: userId, userId, gymId: user?.gymId ?? undefined });
    return { message: '2FA disabled' };
  }

  /** Used both at login-completion and for step-up re-auth on sensitive actions. */
  async verifyCode(userId: string, code: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.twoFactorEnabled || !user.twoFactorSecret) return false;
    if (authenticator.check(code, user.twoFactorSecret)) return true;

    // Fall back to a recovery code — single use, consumed on success.
    for (let i = 0; i < user.twoFactorRecoveryCodes.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      if (await bcrypt.compare(code, user.twoFactorRecoveryCodes[i])) {
        const remaining = [...user.twoFactorRecoveryCodes];
        remaining.splice(i, 1);
        await this.prisma.user.update({ where: { id: userId }, data: { twoFactorRecoveryCodes: remaining } });
        await this.audit.log({ action: 'ADMIN_2FA_RECOVERY_CODE_USED', entity: 'User', entityId: userId, userId, gymId: user.gymId ?? undefined });
        return true;
      }
    }
    return false;
  }

  async regenerateRecoveryCodes(userId: string) {
    const recoveryCodes = await this.generateRecoveryCodes();
    const hashed = await Promise.all(recoveryCodes.map((c) => bcrypt.hash(c, 10)));
    await this.prisma.user.update({ where: { id: userId }, data: { twoFactorRecoveryCodes: hashed } });
    return { recoveryCodes };
  }

  private async generateRecoveryCodes(): Promise<string[]> {
    return Array.from({ length: RECOVERY_CODE_COUNT }, () => randomBytes(5).toString('hex'));
  }
}
