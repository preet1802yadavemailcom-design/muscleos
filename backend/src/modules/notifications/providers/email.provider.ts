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
    const formattedHtml = this.formatHtml(html, subject);

    // 1. Try Resend if configured
    if (this.resendClient) {
      try {
        const { data, error } = await this.resendClient.emails.send({
          from: this.resendFrom,
          to,
          subject,
          html: formattedHtml,
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
          html: formattedHtml,
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

  private formatHtml(content: string, title?: string): string {
    if (content.includes('<html') || content.includes('<body') || content.includes('<div')) {
      return content;
    }
    const urlMatch = content.match(/https?:\/\/[^\s)]+/);
    const actionUrl = urlMatch ? urlMatch[0] : null;

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title || 'MuscleOS'}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 32px 16px;">
  <div style="max-width: 560px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
    <div style="background-color: #0f172a; padding: 24px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.5px;">MuscleOS</h1>
    </div>
    <div style="padding: 32px 24px; color: #1e293b; line-height: 1.6; font-size: 15px;">
      ${title ? `<h2 style="margin-top: 0; color: #0f172a; font-size: 18px; font-weight: 600;">${title}</h2>` : ''}
      <p style="margin-bottom: 24px; white-space: pre-line;">${content}</p>
      ${
        actionUrl
          ? `<div style="text-align: center; margin: 32px 0;">
              <a href="${actionUrl}" style="background-color: #f59e0b; color: #000000; font-weight: 600; padding: 12px 28px; text-decoration: none; border-radius: 8px; display: inline-block;">
                Activate Your Account
              </a>
            </div>
            <p style="font-size: 13px; color: #64748b; margin-top: 24px;">
              Or copy and paste this URL into your browser:<br>
              <a href="${actionUrl}" style="color: #2563eb; word-break: break-all;">${actionUrl}</a>
            </p>`
          : ''
      }
    </div>
    <div style="background-color: #f8fafc; padding: 16px 24px; text-align: center; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8;">
      Sent via MuscleOS Notification Engine
    </div>
  </div>
</body>
</html>`;
  }
}
