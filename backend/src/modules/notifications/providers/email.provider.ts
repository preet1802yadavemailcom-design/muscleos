import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '@shared/services/logger.service';
import * as nodemailer from 'nodemailer';
import { Resend } from 'resend';

@Injectable()
export class EmailProvider implements OnModuleInit {
  private resendClient: Resend | null = null;
  private smtpTransporter: nodemailer.Transporter | null = null;
  private from: string;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
  ) {}

  onModuleInit() {
    const resendApiKey = this.config.get('RESEND_API_KEY');
    if (resendApiKey) {
      this.resendClient = new Resend(resendApiKey);
      this.logger.log('Resend email client initialized', 'EmailProvider');
    }

    const smtpHost = this.config.get('SMTP_HOST');
    if (smtpHost) {
      const port = Number(this.config.get('SMTP_PORT', 587));
      const rawUser = this.config.get('SMTP_USER');
      const user = rawUser ? rawUser.trim() : undefined;
      const rawPass = this.config.get('SMTP_PASS');
      const pass = rawPass ? rawPass.replace(/\s+/g, '').trim() : undefined;

      if (smtpHost.toLowerCase().includes('gmail')) {
        this.smtpTransporter = nodemailer.createTransport({
          service: 'gmail',
          auth: user && pass ? { user, pass } : undefined,
          tls: {
            rejectUnauthorized: false,
          },
        });
        this.logger.log(`Gmail SMTP transporter initialized for ${user}`, 'EmailProvider');
      } else {
        this.smtpTransporter = nodemailer.createTransport({
          host: smtpHost,
          port,
          secure: port === 465,
          auth: user && pass ? { user, pass } : undefined,
          tls: {
            rejectUnauthorized: false,
          },
        });
        this.logger.log(`SMTP transporter initialized (${smtpHost}:${port})`, 'EmailProvider');
      }
    }

    this.from =
      this.config.get('SMTP_FROM') ||
      this.config.get('EMAIL_FROM') ||
      (this.config.get('SMTP_USER') ? `MuscleOS <${this.config.get('SMTP_USER').trim()}>` : 'MuscleOS <onboarding@resend.dev>');
  }

  async send(to: string, subject: string, html: string): Promise<{ success: boolean; error?: string }> {
    // 1. Try Resend if configured
    if (this.resendClient) {
      try {
        const { data, error } = await this.resendClient.emails.send({
          from: this.from,
          to,
          subject,
          html,
        });
        if (error) {
          this.logger.error(`Resend send failed: ${error.message}`, undefined, 'EmailProvider');
          // If Resend failed, fall through to SMTP if available
          if (!this.smtpTransporter) {
            return { success: false, error: error.message };
          }
        } else {
          this.logger.log(`Email sent via Resend to ${to} (id: ${data?.id})`, 'EmailProvider');
          return { success: true };
        }
      } catch (error: any) {
        this.logger.error(`Resend send exception: ${error.message}`, error.stack, 'EmailProvider');
        if (!this.smtpTransporter) {
          return { success: false, error: error.message };
        }
      }
    }

    // 2. Try SMTP if configured
    if (this.smtpTransporter) {
      try {
        const info = await this.smtpTransporter.sendMail({
          from: this.from,
          to,
          subject,
          html,
        });
        this.logger.log(`Email sent via SMTP to ${to} (messageId: ${info.messageId})`, 'EmailProvider');
        return { success: true };
      } catch (error: any) {
        this.logger.error(`SMTP send failed: ${error.message}`, error.stack, 'EmailProvider');
        return { success: false, error: error.message };
      }
    }

    // 3. Fallback for development / mock environments
    this.logger.warn(`No email transport configured (neither Resend nor SMTP) — simulated delivery to ${to}: "${subject}"`, 'EmailProvider');
    return { success: true };
  }
}
