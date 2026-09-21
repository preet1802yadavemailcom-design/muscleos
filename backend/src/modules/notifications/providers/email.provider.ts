import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '@shared/services/logger.service';
import * as nodemailer from 'nodemailer';
import { Resend } from 'resend';

@Injectable()
export class EmailProvider implements OnModuleInit {
  private resendClient: Resend | null = null;
  private smtpTransporter: nodemailer.Transporter | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
  ) {}

  onModuleInit() {
    const resendApiKey = this.config.get('RESEND_API_KEY') || this.config.get('app.resendApiKey') || process.env.RESEND_API_KEY;
    if (resendApiKey) {
      this.resendClient = new Resend(resendApiKey);
      this.logger.log('Resend email client initialized', 'EmailProvider');
    }

    const smtpHost = this.config.get('SMTP_HOST') || this.config.get('app.smtpHost') || process.env.SMTP_HOST;
    if (smtpHost) {
      const rawPort = this.config.get('SMTP_PORT') || this.config.get('app.smtpPort') || process.env.SMTP_PORT;
      const port = Number(rawPort || 587);
      const rawUser = this.config.get('SMTP_USER') || this.config.get('app.smtpUser') || process.env.SMTP_USER;
      const user = rawUser ? rawUser.trim() : undefined;
      const rawPass = this.config.get('SMTP_PASS') || this.config.get('app.smtpPass') || process.env.SMTP_PASS;
      const pass = rawPass ? rawPass.replace(/\s+/g, '').trim() : undefined;

      const timeoutOptions = {
        connectionTimeout: 8000,
        greetingTimeout: 8000,
        socketTimeout: 12000,
        dnsTimeout: 5000,
      };

      if (smtpHost.toLowerCase().includes('gmail')) {
        this.smtpTransporter = nodemailer.createTransport({
          service: 'gmail',
          auth: user && pass ? { user, pass } : undefined,
          tls: {
            rejectUnauthorized: false,
          },
          ...timeoutOptions,
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
          ...timeoutOptions,
        });
        this.logger.log(`SMTP transporter initialized (${smtpHost}:${port})`, 'EmailProvider');
      }
    }

    const emailFrom = this.config.get('EMAIL_FROM') || process.env.EMAIL_FROM;
    if (emailFrom && !emailFrom.includes('@gmail.com') && !emailFrom.includes('@yahoo.com')) {
      this.resendFrom = emailFrom;
    } else {
      this.resendFrom = 'MuscleOS <onboarding@resend.dev>';
    }

    this.smtpFrom =
      this.config.get('SMTP_FROM') ||
      process.env.SMTP_FROM ||
      (this.config.get('SMTP_USER') ? `MuscleOS <${this.config.get('SMTP_USER').trim()}>` : 'MuscleOS <onboarding@resend.dev>');
  }

  private resendFrom: string;
  private smtpFrom: string;

  async send(to: string, subject: string, html: string): Promise<{ success: boolean; error?: string }> {
    // 1. Try Resend if configured
    if (this.resendClient) {
      try {
        const { data, error } = await this.resendClient.emails.send({
          from: this.resendFrom,
          to,
          subject,
          html,
        });
        if (error) {
          console.error(`[RESEND FAILED] ${error.message}`);
          this.logger.error(`Resend send failed: ${error.message}`, undefined, 'EmailProvider');
          if (!this.smtpTransporter) {
            return { success: false, error: error.message };
          }
        } else {
          console.log(`[RESEND SUCCESS] Email sent to ${to} (id: ${data?.id})`);
          this.logger.log(`Email sent via Resend to ${to} (id: ${data?.id})`, 'EmailProvider');
          return { success: true };
        }
      } catch (error: any) {
        console.error(`[RESEND EXCEPTION] ${error.message}`);
        this.logger.error(`Resend send exception: ${error.message}`, error.stack, 'EmailProvider');
        if (!this.smtpTransporter) {
          return { success: false, error: error.message };
        }
      }
    }

    // 2. Try SMTP if configured
    if (this.smtpTransporter) {
      try {
        const sendPromise = this.smtpTransporter.sendMail({
          from: this.smtpFrom,
          to,
          subject,
          html,
        });
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('SMTP timeout after 12s')), 12000),
        );
        const info: any = await Promise.race([sendPromise, timeoutPromise]);
        this.logger.log(`Email sent via SMTP to ${to} (messageId: ${info.messageId})`, 'EmailProvider');
        console.log(`[SMTP SUCCESS] Email sent to ${to} (${info.messageId})`);
        return { success: true };
      } catch (error: any) {
        this.logger.error(`SMTP send failed: ${error.message}`, error.stack, 'EmailProvider');
        console.error(`[SMTP FAILED] Could not send to ${to}: ${error.message}`);
        return { success: false, error: error.message };
      }
    }

    // 3. Fallback for development / mock environments
    this.logger.warn(`No email transport configured (neither Resend nor SMTP) — simulated delivery to ${to}: "${subject}"`, 'EmailProvider');
    console.warn(`[SMTP SIMULATED] No email transport configured for ${to}`);
    return { success: true };
  }
}
