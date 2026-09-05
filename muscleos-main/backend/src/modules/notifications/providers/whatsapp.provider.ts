import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '@shared/services/logger.service';

/**
 * WhatsApp Cloud API (Meta) — free tier: 1000 service conversations/month,
 * no per-message cost within that limit. Needs a Meta Business App with the
 * WhatsApp product added; env vars:
 *   WHATSAPP_PHONE_NUMBER_ID  — from Meta App > WhatsApp > API Setup
 *   WHATSAPP_ACCESS_TOKEN     — permanent or long-lived system-user token
 *
 * Uses a pre-approved template message ("otp_message" or similar) for the
 * first contact in a 24h window, per WhatsApp policy — plain free-text
 * messages only work within 24h of the user having messaged the business
 * first. For gym use (staff-initiated attendance/payment alerts), template
 * messages are the reliable path.
 */
@Injectable()
export class WhatsappProvider {
  private phoneNumberId: string;
  private accessToken: string;

  constructor(
    private readonly config: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.phoneNumberId = this.config.get('WHATSAPP_PHONE_NUMBER_ID', '');
    this.accessToken = this.config.get('WHATSAPP_ACCESS_TOKEN', '');
  }

  private get configured(): boolean {
    return !!this.phoneNumberId && !!this.accessToken;
  }

  /** Plain text message — only deliverable within a 24h customer-initiated
   *  session window. Use `sendTemplate` for anything outside that window
   *  (e.g. the very first message to a member, like a welcome/OTP). */
  async send(to: string, body: string): Promise<{ success: boolean; error?: string }> {
    if (!this.configured) {
      this.logger.warn(`WhatsApp not configured — skipping message to ${to}`, 'WhatsappProvider');
      return { success: false, error: 'WhatsApp Cloud API not configured' };
    }
    return this.callGraphApi({
      messaging_product: 'whatsapp',
      to: this.normalize(to),
      type: 'text',
      text: { body },
    });
  }

  /** Template message — required for the first contact / outside the 24h
   *  window. `templateName` must already be approved in Meta Business
   *  Manager (e.g. "attendance_alert", "payment_reminder"). */
  async sendTemplate(
    to: string,
    templateName: string,
    languageCode = 'en',
    params: string[] = [],
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.configured) {
      this.logger.warn(`WhatsApp not configured — skipping template "${templateName}" to ${to}`, 'WhatsappProvider');
      return { success: false, error: 'WhatsApp Cloud API not configured' };
    }
    return this.callGraphApi({
      messaging_product: 'whatsapp',
      to: this.normalize(to),
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        ...(params.length
          ? { components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }] }
          : {}),
      },
    });
  }

  private async callGraphApi(payload: Record<string, unknown>): Promise<{ success: boolean; error?: string }> {
    try {
      const res = await fetch(`https://graph.facebook.com/v19.0/${this.phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        const error = data?.error?.message || `WhatsApp API error (${res.status})`;
        this.logger.error(`WhatsApp send failed: ${error}`, undefined, 'WhatsappProvider');
        return { success: false, error };
      }
      return { success: true };
    } catch (error: any) {
      this.logger.error(`WhatsApp send failed: ${error.message}`, error.stack, 'WhatsappProvider');
      return { success: false, error: error.message };
    }
  }

  /** WhatsApp Cloud API expects E.164 without a leading '+' (e.g. 919876543210). */
  private normalize(mobile: string): string {
    const digits = mobile.replace(/\D/g, '');
    if (digits.length === 10) return `91${digits}`; // bare 10-digit Indian numbers
    return digits;
  }
}
