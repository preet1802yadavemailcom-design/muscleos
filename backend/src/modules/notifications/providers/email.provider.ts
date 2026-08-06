import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '@shared/services/logger.service';
import { Resend } from 'resend';

@Injectable()
export class EmailProvider implements OnModuleInit {
  private client: Resend | null = null;
  private from: string;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
  ) {}

  onModuleInit() {
    const apiKey = this.config.get('RESEND_API_KEY');
    if (apiKey) {
      this.client = new Resend(apiKey);
    }
    // In dev, Resend allows sending from onboarding@resend.dev to the account owner's
    // email. Once a domain is verified, set EMAIL_FROM to e.g. "MuscleOS <noreply@yourdomain.com>".
    this.from = this.config.get('EMAIL_FROM', 'MuscleOS <onboarding@resend.dev>');
  }

  async send(to: string, subject: string, html: string): Promise<{ success: boolean; error?: string }> {
    if (!this.client) {
      this.logger.warn(`Resend not configured (RESEND_API_KEY missing) — skipping email to ${to}`, 'EmailProvider');
      return { success: false, error: 'Resend not configured' };
    }
    try {
      const { data, error } = await this.client.emails.send({
        from: this.from,
        to,
        subject,
        html,
      });
      if (error) {
        this.logger.error(`Resend send failed: ${error.message}`, undefined, 'EmailProvider');
        return { success: false, error: error.message };
      }
      this.logger.log(`Email sent to ${to} (resend id: ${data?.id})`, 'EmailProvider');
      return { success: true };
    } catch (error: any) {
      this.logger.error(`Resend send failed: ${error.message}`, error.stack, 'EmailProvider');
      return { success: false, error: error.message };
    }
  }
}
