import { Global, Module } from '@nestjs/common';
import { AdminAuditService } from './admin-audit.service';
import { AdminAuditController } from './admin-audit.controller';
import { AuditSigner } from './audit-signer';

@Global()
@Module({
  controllers: [AdminAuditController],
  providers: [AdminAuditService, AuditSigner],
  exports: [AdminAuditService],
})
export class AdminAuditModule {}
