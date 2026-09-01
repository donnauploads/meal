import { Global, Module } from '@nestjs/common';
import { MeSecurityService } from './me-security.service';
import { MeSecurityController } from './me-security.controller';
import { TotpService } from './totp.service';

@Global()
@Module({
  providers: [MeSecurityService, TotpService],
  controllers: [MeSecurityController],
  exports: [MeSecurityService, TotpService],
})
export class MeSecurityModule {}
