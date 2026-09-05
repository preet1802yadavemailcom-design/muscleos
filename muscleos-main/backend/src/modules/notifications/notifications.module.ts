import { Module } from '@nestjs/common';

import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { EmailProvider } from './providers/email.provider';
import { PushProvider } from './providers/push.provider';
import { SmsProvider } from './providers/sms.provider';
import { WhatsappProvider } from './providers/whatsapp.provider';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, EmailProvider, SmsProvider, PushProvider, WhatsappProvider],
  exports: [NotificationsService, EmailProvider, WhatsappProvider, PushProvider],
})
export class NotificationsModule {}
