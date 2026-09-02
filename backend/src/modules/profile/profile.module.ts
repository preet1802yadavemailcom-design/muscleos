import { Module } from '@nestjs/common';
import { NotificationsModule } from '@modules/notifications/notifications.module';

import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

@Module({
  imports: [NotificationsModule],
  controllers: [ProfileController],
  providers: [ProfileService],
})
export class ProfileModule {}
