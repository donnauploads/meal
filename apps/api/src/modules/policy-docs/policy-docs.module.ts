import { Module } from '@nestjs/common';
import { PolicyDocsService } from './policy-docs.service';
import { PolicyDocsController } from './policy-docs.controller';
import { PolicyRenderer } from './policy.renderer';

@Module({
  providers: [PolicyDocsService, PolicyRenderer],
  controllers: [PolicyDocsController],
  exports: [PolicyDocsService],
})
export class PolicyDocsModule {}
