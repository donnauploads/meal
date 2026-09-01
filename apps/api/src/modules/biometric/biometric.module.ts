import { Module } from '@nestjs/common';
import { BiometricService } from './biometric.service';
import { BiometricController } from './biometric.controller';
import { BiometricAuthController } from './biometric-auth.controller';
import { DevicesModule } from '../devices/devices.module';
import { SessionsModule } from '../sessions/sessions.module';

@Module({
  imports: [DevicesModule, SessionsModule],
  providers: [BiometricService],
  controllers: [BiometricController, BiometricAuthController],
  exports: [BiometricService],
})
export class BiometricModule {}
