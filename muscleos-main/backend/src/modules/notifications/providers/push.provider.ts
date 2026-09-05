import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@database/prisma.service';
import { LoggerService } from '@shared/services/logger.service';
import * as jwt from 'jsonwebtoken';

/**
 * Real Firebase Cloud Messaging (HTTP v1 API) — free, no per-message cost.
 * Google shut down the old "legacy Server Key" API in June 2024, so this
 * uses a service-account (OAuth2) flow instead:
 *   1. Sign a short-lived JWT with the service account's private key.
 *   2. Exchange it for a Google access token.
 *   3. Call the v1 send endpoint with that access token.
 *
 * Env vars needed (from Firebase Console > Project Settings > Service
 * Accounts > Generate new private key):
 *   FIREBASE_PROJECT_ID
 *   FIREBASE_CLIENT_EMAIL
 *   FIREBASE_PRIVATE_KEY   (keep the \n escapes — this reads them literally
 *                           and converts to real newlines)
 */
@Injectable()
export class PushProvider {
  private cachedToken: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService,
  ) {}

  private get projectId(): string {
    return this.config.get('FIREBASE_PROJECT_ID', '');
  }

  private get configured(): boolean {
    return !!this.projectId && !!this.config.get('FIREBASE_CLIENT_EMAIL') && !!this.config.get('FIREBASE_PRIVATE_KEY');
  }

  private async getAccessToken(): Promise<string | null> {
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now() + 30_000) {
      return this.cachedToken.value;
    }
    const clientEmail = this.config.get('FIREBASE_CLIENT_EMAIL');
    const privateKey = String(this.config.get('FIREBASE_PRIVATE_KEY', '')).replace(/\\n/g, '\n');
    const now = Math.floor(Date.now() / 1000);

    const assertion = jwt.sign(
      {
        iss: clientEmail,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
      },
      privateKey,
      { algorithm: 'RS256' },
    );

    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        this.logger.error(`FCM OAuth token exchange failed: ${JSON.stringify(data)}`, undefined, 'PushProvider');
        return null;
      }
      this.cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
      return this.cachedToken.value;
    } catch (error: any) {
      this.logger.error(`FCM OAuth token exchange failed: ${error.message}`, error.stack, 'PushProvider');
      return null;
    }
  }

  /** Sends to every device token the user has registered. Tokens FCM
   *  reports as unregistered/invalid are deleted so they stop being tried. */
  async send(userId: string, title: string, body: string): Promise<{ success: boolean; error?: string }> {
    if (!this.configured) {
      this.logger.warn(`Push not sent to ${userId} — Firebase service account not configured`, 'PushProvider');
      return { success: false, error: 'Push notifications are not configured for this deployment' };
    }

    const tokens = await this.prisma.pushToken.findMany({ where: { userId } });
    if (tokens.length === 0) {
      return { success: false, error: 'No registered devices for this user' };
    }

    const accessToken = await this.getAccessToken();
    if (!accessToken) {
      return { success: false, error: 'Could not authenticate with Firebase' };
    }

    let anySuccess = false;
    let lastError: string | undefined;

    for (const t of tokens) {
      try {
        const res = await fetch(`https://fcm.googleapis.com/v1/projects/${this.projectId}/messages:send`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              token: t.token,
              notification: { title, body },
            },
          }),
        });
        if (res.ok) {
          anySuccess = true;
        } else {
          const data = await res.json().catch(() => ({}));
          const errStatus = data?.error?.status;
          lastError = data?.error?.message || `FCM error ${res.status}`;
          if (errStatus === 'UNREGISTERED' || errStatus === 'NOT_FOUND' || errStatus === 'INVALID_ARGUMENT') {
            // Stale/invalid token — remove it so we stop retrying it forever.
            await this.prisma.pushToken.delete({ where: { id: t.id } }).catch(() => undefined);
          }
        }
      } catch (error: any) {
        lastError = error.message;
      }
    }

    return anySuccess ? { success: true } : { success: false, error: lastError ?? 'All device sends failed' };
  }

  /** Registers or refreshes a device's push token — called by the frontend
   *  right after the browser/app grants notification permission. */
  async registerToken(userId: string, token: string, platform = 'web') {
    await this.prisma.pushToken.upsert({
      where: { token },
      update: { userId, platform },
      create: { userId, token, platform },
    });
    return { message: 'Device registered for push notifications' };
  }

  async unregisterToken(token: string) {
    await this.prisma.pushToken.deleteMany({ where: { token } });
    return { message: 'Device unregistered' };
  }
}
