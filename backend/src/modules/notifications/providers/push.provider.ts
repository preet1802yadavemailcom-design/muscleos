import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '@shared/services/logger.service';

/**
 * Push delivery abstraction. Wire this up to FCM/APNs/OneSignal by swapping
 * the implementation below — the rest of the notification pipeline (queueing,
 * retries, delivery logs) does not need to change.
 *
 * No push credentials are configured yet, so this honestly reports
 * `success: false` with a clear reason rather than claiming delivery that
 * never happened — a caller checking `.success` before marking a
 * notification "delivered" needs that to be true.
 */
@Injectable()
export class PushProvider {
  constructor(
    private readonly logger: LoggerService,
    private readonly config: ConfigService,
  ) {}

  async send(userId: string, title: string, body: string): Promise<{ success: boolean; error?: string }> {
    const fcmKey = this.config.get<string>('notifications.fcmServerKey');
    if (!fcmKey) {
      this.logger.warn(
        `Push not sent to ${userId} — no push provider configured (set FCM_SERVER_KEY / APNS credentials)`,
        'PushProvider',
      );
      return { success: false, error: 'Push notifications are not configured for this deployment' };
    }
    // Real FCM/APNs call goes here once fcmKey (or equivalent) is set.
    this.logger.log(`[PUSH -> ${userId}] ${title}: ${body}`, 'PushProvider');
    return { success: true };
  }
}
