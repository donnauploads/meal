import { Module } from '@nestjs/common';
import { SignupService } from './signup.service';
import { SignupController } from './signup.controller';
import { VerificationService } from './verification.service';
import { VerificationController } from './verification.controller';
import { RecoveryController } from './recovery.controller';
import { MfaModule } from '../../mfa/mfa.module';
import { SessionsModule } from '../../sessions/sessions.module';

@Module({
  imports: [MfaModule, SessionsModule],
  providers: [SignupService, VerificationService],
  controllers: [SignupController, VerificationController, RecoveryController],
  exports: [SignupService],
})
export class SignupModule {}
