import { UsersModule } from '@modules/users/users.module';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { NotificationsModule } from '@modules/notifications/notifications.module';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TwoFactorService } from './two-factor.service';
import { StepUpService } from './step-up.service';
import { StepUpGuard } from './guards/step-up.guard';
import { TwoFactorSetupGuard } from '@common/guards/two-factor-setup.guard';
import { JwtStrategy } from './strategies/jwt.strategy';
import { LocalStrategy } from './strategies/local.strategy';
import { GoogleStrategy } from './strategies/google.strategy';

@Module({
  imports: [
    UsersModule,
    NotificationsModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get('app.jwtSecret'),
        signOptions: { expiresIn: config.get('app.jwtAccessExpiration', '15m') },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, TwoFactorService, StepUpService, StepUpGuard, TwoFactorSetupGuard, JwtStrategy, LocalStrategy, GoogleStrategy],
  exports: [AuthService, TwoFactorService, StepUpService, StepUpGuard],
})
export class AuthModule {}
