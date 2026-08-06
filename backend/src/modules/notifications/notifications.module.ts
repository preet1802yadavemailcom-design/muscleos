import { Module } from '@nestjs/common';

import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { EmailProvider } from './providers/email.provider';
import { PushProvider } from './providers/push.provider';
import { SmsProvider } from './providers/sms.provider';

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, EmailProvider, SmsProvider, PushProvider],
  exports: [NotificationsService],
})
export class NotificationsModule {}
