import { QrModule } from '@modules/qr/qr.module';
import { Module } from '@nestjs/common';

import { AttendanceCoreService } from './attendance-core.service';
import { AttendanceStreamController } from './attendance-stream.controller';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';

@Module({
  imports: [QrModule],
  controllers: [AttendanceController, AttendanceStreamController],
  providers: [AttendanceService, AttendanceCoreService],
  exports: [AttendanceService, AttendanceCoreService],
})
export class AttendanceModule {}
