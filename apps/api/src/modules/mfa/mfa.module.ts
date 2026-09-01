import { Module } from '@nestjs/common';
import { MfaService } from './mfa.service';

// SMS_PROVIDER is now bound globally by SmsModule (Stage 11).
@Module({
  providers: [MfaService],
  exports: [MfaService],
})
export class MfaModule {}
