import { AttendanceModule } from '@modules/attendance/attendance.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { QrModule } from '@modules/qr/qr.module';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { CheckinController } from './checkin.controller';
import { CheckinService } from './checkin.service';

@Module({
  imports: [JwtModule.register({}), AttendanceModule, QrModule, NotificationsModule],
  controllers: [CheckinController],
  providers: [CheckinService],
  exports: [CheckinService],
})
export class CheckinModule {}
