import { Global, Module } from '@nestjs/common';
import { ElevationService } from './elevation.service';
import { ElevationController } from './elevation.controller';
import { ElevationGuard } from './elevation.guard';
import { TransactionPinService } from './transaction-pin.service';
import { TransactionPinController } from './transaction-pin.controller';
import { BiometricElevationController } from './biometric-elevation.controller';
import { MfaModule } from '../mfa/mfa.module';
import { DevicesModule } from '../devices/devices.module';
import { BiometricModule } from '../biometric/biometric.module';

@Global()
@Module({
  imports: [MfaModule, DevicesModule, BiometricModule],
  providers: [ElevationService, ElevationGuard, TransactionPinService],
  controllers: [
    ElevationController,
    TransactionPinController,
    BiometricElevationController,
  ],
  exports: [ElevationService, ElevationGuard, TransactionPinService],
})
export class ElevationModule {}
