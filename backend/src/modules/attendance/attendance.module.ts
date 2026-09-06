import { Module } from '@nestjs/common';
import { AuthModule } from '@modules/auth/auth.module';

import { AttendanceController } from './attendance.controller';
import { AttendanceStreamController } from './attendance-stream.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceCoreService } from './attendance-core.service';
import { QrModule } from '@modules/qr/qr.module';

@Module({
  imports: [QrModule, AuthModule],
  controllers: [AttendanceController, AttendanceStreamController],
  providers: [AttendanceService, AttendanceCoreService],
  exports: [AttendanceService, AttendanceCoreService],
})
export class AttendanceModule {}
