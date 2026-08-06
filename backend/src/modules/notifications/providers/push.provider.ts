import { Injectable } from '@nestjs/common';
import { LoggerService } from '@shared/services/logger.service';

/**
 * Push delivery abstraction. Wire this up to FCM/APNs/OneSignal by swapping
 * the implementation below — the rest of the notification pipeline (queueing,
 * retries, delivery logs) does not need to change.
 */
@Injectable()
export class PushProvider {
  constructor(private readonly logger: LoggerService) {}

  async send(userId: string, title: string, body: string): Promise<{ success: boolean; error?: string }> {
    this.logger.log(`[PUSH -> ${userId}] ${title}: ${body}`, 'PushProvider');
    // TODO: integrate FCM/APNs credentials via ConfigService when available.
    return { success: true };
  }
}
