import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAccessStrategy } from './strategies/jwt-access.strategy';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';
import { DevicesModule } from '../devices/devices.module';
import { MfaModule } from '../mfa/mfa.module';
import { SessionsModule } from '../sessions/sessions.module';
import { AuthNotificationsModule } from './notifications/auth-notifications.module';
import { SignupModule } from './signup/signup.module';

@Module({
  imports: [
    PassportModule,
    DevicesModule,
    MfaModule,
    SessionsModule,
    AuthNotificationsModule,
    SignupModule,
  ],
  providers: [AuthService, JwtAccessStrategy, JwtRefreshStrategy],
  controllers: [AuthController],
  exports: [AuthService],
})
export class AuthModule {}
