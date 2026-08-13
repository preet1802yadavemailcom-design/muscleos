import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '@shared/services/logger.service';

@Injectable()
export class SmsProvider implements OnModuleInit {
  private client: any;
  private fromNumber: string;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
  ) {}

  onModuleInit() {
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
