import * as crypto from 'crypto';

import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

/**
 * Thin Stripe REST wrapper (PaymentIntents) — avoids pulling in the full stripe SDK.
 * Docs: https://stripe.com/docs/api/payment_intents
 */
@Injectable()
export class StripeGateway {
  private readonly baseUrl = 'https://api.stripe.com/v1';

  constructor(private readonly config: ConfigService) {}

  private get authHeader() {
    const secret = this.config.get<string>('app.stripeSecretKey');
    return { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/x-www-form-urlencoded' };
  }

  async createPaymentIntent(amountInCents: number, currency = 'usd', metadata?: Record<string, string>) {
    const params = new URLSearchParams();
    params.append('amount', String(amountInCents));
    params.append('currency', currency);
    params.append('automatic_payment_methods[enabled]', 'true');
    if (metadata) {
      Object.entries(metadata).forEach(([k, v]) => params.append(`metadata[${k}]`, v));
    }
    const { data } = await axios.post(`${this.baseUrl}/payment_intents`, params, {
      headers: this.authHeader,
    });
    return data;
  }

  async retrievePaymentIntent(id: string) {
    const { data } = await axios.get(`${this.baseUrl}/payment_intents/${id}`, {
      headers: this.authHeader,
    });
    return data;
  }

  verifyWebhookSignature(rawBody: string, sigHeader: string): boolean {
    const secret = this.config.get<string>('app.stripeWebhookSecret')!;
    if (!sigHeader) return false;
    const parts = Object.fromEntries(sigHeader.split(',').map((p) => p.split('=') as [string, string]));
    const signedPayload = `${parts.t}.${rawBody}`;
    const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
    if (!parts.v1 || expected.length !== parts.v1.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
  }

  async refund(paymentIntentId: string, amountInCents?: number) {
    try {
      const params = new URLSearchParams();
      params.append('payment_intent', paymentIntentId);
      if (amountInCents) params.append('amount', String(amountInCents));
      const { data } = await axios.post(`${this.baseUrl}/refunds`, params, { headers: this.authHeader });
      return data;
    } catch (err: any) {
      throw new BadRequestException(err?.response?.data?.error?.message || 'Stripe refund failed');
    }
  }
}
