import * as crypto from 'crypto';

import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

/**
 * Thin Razorpay REST wrapper — avoids pulling in the full razorpay SDK.
 * Docs: https://razorpay.com/docs/api/
 */
@Injectable()
export class RazorpayGateway {
  private readonly baseUrl = 'https://api.razorpay.com/v1';

  constructor(private readonly config: ConfigService) {}

  private get authHeader() {
    const keyId = this.config.get<string>('app.razorpayKeyId');
    const keySecret = this.config.get<string>('app.razorpayKeySecret');
    const token = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    return { Authorization: `Basic ${token}` };
  }

  async createOrder(amountInPaise: number, currency = 'INR', receipt?: string, notes?: Record<string, any>) {
    const { data } = await axios.post(
      `${this.baseUrl}/orders`,
      { amount: amountInPaise, currency, receipt, notes, payment_capture: 1 },
      { headers: this.authHeader },
    );
    return data;
  }

  verifySignature(orderId: string, paymentId: string, signature: string): boolean {
    const secret = this.config.get<string>('app.razorpayKeySecret')!;
    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');
    if (expected.length !== signature.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  }

  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    const secret = this.config.get<string>('app.razorpayWebhookSecret')!;
    const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    if (!signature || expected.length !== signature.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  }

  async fetchPayment(paymentId: string) {
    const { data } = await axios.get(`${this.baseUrl}/payments/${paymentId}`, {
      headers: this.authHeader,
    });
    return data;
  }

  async refund(paymentId: string, amountInPaise?: number) {
    try {
      const { data } = await axios.post(
        `${this.baseUrl}/payments/${paymentId}/refund`,
        amountInPaise ? { amount: amountInPaise } : {},
        { headers: this.authHeader },
      );
      return data;
    } catch (err: any) {
      throw new BadRequestException(err?.response?.data?.error?.description || 'Razorpay refund failed');
    }
  }
}
