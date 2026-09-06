import { randomUUID } from 'crypto';

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { RedisService } from '@database/redis.service';
import { PrismaService } from '@database/prisma.service';
import { AuditService } from '@shared/services/audit.service';
import * as bcrypt from 'bcryptjs';

import { TwoFactorService } from './two-factor.service';

const STEP_UP_TTL_SECONDS = 5 * 60; // narrow window — re-auth proves "you, right now", not "you, earlier today"

/**
 * Sensitive, hard-to-undo actions (delete/suspend an organization, change
 * platform billing, change security settings) shouldn't be reachable with
 * just a long-lived access token sitting in local storage — this makes the
 * caller re-prove their password (+ 2FA if enabled) immediately before the
 * action, the same way a bank re-asks for a PIN on a large transfer.
 */
@Injectable()
export class StepUpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly twoFactor: TwoFactorService,
    private readonly audit: AuditService,
  ) {}

  async verify(userId: string, password: string, twoFactorCode?: string, action?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Account not found');
    if (!user.password) throw new UnauthorizedException('This account has no password set (signed up with Google)');

    const passwordOk = await bcrypt.compare(password, user.password);
    if (!passwordOk) {
      await this.audit.log({ action: 'STEP_UP_AUTH_FAILED', entity: 'User', entityId: userId, userId, gymId: user.gymId ?? undefined });
      throw new UnauthorizedException('Incorrect password');
    }

    if (user.twoFactorEnabled) {
      if (!twoFactorCode) throw new UnauthorizedException('2FA code required');
      const codeOk = await this.twoFactor.verifyCode(userId, twoFactorCode);
      if (!codeOk) {
        await this.audit.log({ action: 'STEP_UP_AUTH_FAILED', entity: 'User', entityId: userId, userId, gymId: user.gymId ?? undefined });
        throw new UnauthorizedException('Invalid 2FA code');
      }
    }

    const token = randomUUID();
    const payload = JSON.stringify({ action: action || 'GENERAL', createdAt: Date.now() });
    await this.redis.set(`step_up:${userId}:${token}`, payload, STEP_UP_TTL_SECONDS);
    await this.audit.log({ action: 'STEP_UP_AUTH_GRANTED', entity: 'User', entityId: userId, userId, gymId: user.gymId ?? undefined });
    return { stepUpToken: token, expiresInSeconds: STEP_UP_TTL_SECONDS };
  }

  /** Single-use: consumed atomically via getDel so a leaked token can't be replayed for a second sensitive action. */
  async consume(userId: string, token: string, expectedAction?: string): Promise<boolean> {
    const key = `step_up:${userId}:${token}`;
    const value = await this.redis.getDel(key);
    if (!value) return false;
    if (value === '1') return true;
    try {
      const parsed = JSON.parse(value);
      if (expectedAction && parsed.action && parsed.action !== 'GENERAL' && parsed.action !== expectedAction) {
        return false;
      }
      return true;
    } catch {
      return true;
    }
  }
}
