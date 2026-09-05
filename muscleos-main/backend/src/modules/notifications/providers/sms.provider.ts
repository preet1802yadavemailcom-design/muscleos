import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '@shared/services/logger.service';

/**
 * Twilio SMS — deliberately LOCKED (disabled) for now. WhatsApp is the
 * primary verification/notification channel; Twilio costs money per SMS
 * and isn't needed while WhatsApp covers the same use cases for free.
 *
 * The integration is fully wired and ready — set TWILIO_ENABLED=true (plus
 * the usual TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_PHONE_NUMBER) to
 * turn it back on later without touching any calling code.
 */
@Injectable()
export class SmsProvider implements OnModuleInit {
  private client: any;
  private fromNumber: string;
  private enabled = false;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
  ) {}

  onModuleInit() {
    this.enabled = this.config.get('TWILIO_ENABLED', 'false') === 'true';
    if (!this.enabled) {
      this.logger.log('Twilio SMS is locked (TWILIO_ENABLED is not "true") — WhatsApp is the active channel.', 'SmsProvider');
      return;
    }
    const sid = this.config.get('TWILIO_ACCOUNT_SID');
    const token = this.config.get('TWILIO_AUTH_TOKEN');
    this.fromNumber = this.config.get('TWILIO_PHONE_NUMBER', '');
    if (sid && token) {
      // Lazy require so environments without Twilio configured don't pay the import cost.
      const twilio = require('twilio');
      this.client = twilio(sid, token);
    }
  }

  async send(to: string, body: string): Promise<{ success: boolean; error?: string }> {
    if (!this.enabled) {
      this.logger.warn(`Twilio SMS is locked — skipping SMS to ${to}. Set TWILIO_ENABLED=true to re-enable.`, 'SmsProvider');
      return { success: false, error: 'Twilio SMS is currently disabled' };
    }
    if (!this.client) {
      this.logger.warn(`Twilio not configured — skipping SMS to ${to}`, 'SmsProvider');
      return { success: false, error: 'Twilio not configured' };
    }
    try {
      await this.client.messages.create({ to, from: this.fromNumber, body });
      return { success: true };
    } catch (error: any) {
      this.logger.error(`SMS send failed: ${error.message}`, error.stack, 'SmsProvider');
      return { success: false, error: error.message };
    }
  }
}
