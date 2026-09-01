import { Module } from '@nestjs/common';
import { NotificationsModule } from '@modules/notifications/notifications.module';

import { RazorpayGateway } from './gateways/razorpay.gateway';
import { StripeGateway } from './gateways/stripe.gateway';
import { InvoiceGenerator } from './invoice.generator';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [NotificationsModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, RazorpayGateway, StripeGateway, InvoiceGenerator],
  exports: [PaymentsService],
})
export class PaymentsModule {}
