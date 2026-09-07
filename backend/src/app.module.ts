import { RequestIdMiddleware } from '@common/middleware/request-id.middleware';
import { TenantMiddleware } from '@common/middleware/tenant.middleware';
import { AppConfig } from '@config/app.config';
import { DatabaseModule } from '@database/database.module';
import { AttendanceModule } from '@modules/attendance/attendance.module';
import { AuthModule } from '@modules/auth/auth.module';
import { BatchesModule } from '@modules/batches/batches.module';
import { BranchesModule } from '@modules/branches/branches.module';
import { CheckinModule } from '@modules/checkin/checkin.module';
import { FitnessModule } from '@modules/fitness/fitness.module';
import { GymsModule } from '@modules/gyms/gyms.module';
import { HealthModule } from '@modules/health/health.module';
import { MembersModule } from '@modules/members/members.module';
import { MembershipsModule } from '@modules/memberships/memberships.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { PaymentsModule } from '@modules/payments/payments.module';
import { PublicModule } from '@modules/public/public.module';
import { ReceptionModule } from '@modules/reception/reception.module';
import { ReportsModule } from '@modules/reports/reports.module';
import { UsersModule } from '@modules/users/users.module';
import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';

import { LoggerModule } from '@shared/logger.module';
import { SettingsModule } from '@modules/settings/settings.module';
import { QrModule } from '@modules/qr/qr.module';
import { ProfileModule } from '@modules/profile/profile.module';
import { SuperAdminModule } from '@modules/super-admin/super-admin.module';
import { SupportModule } from '@modules/support/support.module';

import { AppController } from './app.controller';


@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [AppConfig],
      envFilePath: ['.env', '../.env'],
    }),
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1000, limit: 10 },
      { name: 'medium', ttl: 10000, limit: 30 },
      { name: 'long', ttl: 60000, limit: 100 },
    ]),
    ScheduleModule.forRoot(),
    DatabaseModule,
    LoggerModule,
    AuthModule,
    UsersModule,
    GymsModule,
    MembersModule,
    BatchesModule,
    AttendanceModule,
    MembershipsModule,
    PaymentsModule,
    NotificationsModule,
    ReportsModule,
    ReceptionModule,
    SettingsModule,
    PublicModule,
    CheckinModule,
    QrModule,
    BranchesModule,
    ProfileModule,
    SuperAdminModule,
    SupportModule,
    FitnessModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(RequestIdMiddleware)
      .forRoutes('*')
      .apply(TenantMiddleware)
      .forRoutes('*');
  }
}
