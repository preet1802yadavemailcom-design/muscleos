import { AttendanceModule } from '@modules/attendance/attendance.module';
import { MembersModule } from '@modules/members/members.module';
import { MembershipsModule } from '@modules/memberships/memberships.module';
import { PaymentsModule } from '@modules/payments/payments.module';
import { Module } from '@nestjs/common';

import { ReceptionController } from './reception.controller';
import { ReceptionService } from './reception.service';

@Module({
  imports: [MembersModule, PaymentsModule, AttendanceModule, MembershipsModule],
  controllers: [ReceptionController],
  providers: [ReceptionService],
  exports: [ReceptionService],
})
export class ReceptionModule {}
