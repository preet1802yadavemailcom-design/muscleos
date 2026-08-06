import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '@shared/services/logger.service';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailProvider implements OnModuleInit {
  private transporter: nodemailer.Transporter;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
  ) {}

  onModuleInit() {
    this.transporter = nodemailer.createTransport({
      host: this.config.get('SMTP_HOST', 'smtp.gmail.com'),
      port: this.config.get<number>('SMTP_PORT', 587),
      secure: this.config.get<number>('SMTP_PORT', 587) === 465,
      auth: {
        user: this.config.get('SMTP_USER'),
        pass: this.config.get('SMTP_PASS'),
      },
    });
  }

  async send(to: string, subject: string, html: string): Promise<{ success: boolean; error?: string }> {
    if (!this.config.get('SMTP_USER')) {
      this.logger.warn(`SMTP not configured — skipping email to ${to}`, 'EmailProvider');
      return { success: false, error: 'SMTP not configured' };
    }
    try {
      await this.transporter.sendMail({
        from: this.config.get('SMTP_FROM', 'MuscleOS <no-reply@muscleos.com>'),
        to,
        subject,
        html,
      });
      return { success: true };
    } catch (error: any) {
      this.logger.error(`Email send failed: ${error.message}`, error.stack, 'EmailProvider');
      return { success: false, error: error.message };
    }
  }
}
