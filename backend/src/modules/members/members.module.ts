import { NotificationsModule } from '@modules/notifications/notifications.module';
import { Module } from '@nestjs/common';

import { MembersController } from './members.controller';
import { MembersService } from './members.service';

@Module({
  imports: [NotificationsModule],
  controllers: [MembersController],
  providers: [MembersService],
  exports: [MembersService],
})
export class MembersModule {}
