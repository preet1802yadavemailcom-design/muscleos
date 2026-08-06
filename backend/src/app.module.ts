import { RequestIdMiddleware } from '@common/middleware/request-id.middleware';
import { TenantMiddleware } from '@common/middleware/tenant.middleware';
import { AppConfig } from '@config/app.config';
import { DatabaseModule } from '@database/database.module';
import { AttendanceModule } from '@modules/attendance/attendance.module';
import { AuthModule } from '@modules/auth/auth.module';
import { BatchesModule } from '@modules/batches/batches.module';
import { GymsModule } from '@modules/gyms/gyms.module';
import { MembersModule } from '@modules/members/members.module';
import { UsersModule } from '@modules/users/users.module';
import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_GUARD } from '@nestjs/core';

import { LoggerModule } from '@shared/logger.module';
import { MembershipsModule } from '@modules/memberships/memberships.module';
import { PaymentsModule } from '@modules/payments/payments.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { ReportsModule } from '@modules/reports/reports.module';
import { ReceptionModule } from '@modules/reception/reception.module';
import { SettingsModule } from '@modules/settings/settings.module';
import { PublicModule } from '@modules/public/public.module';
import { SuperAdminModule } from '@modules/super-admin/super-admin.module';
import { HealthModule } from '@modules/health/health.module';

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
    SuperAdminModule,
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
