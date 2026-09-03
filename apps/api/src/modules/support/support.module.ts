import { Module } from '@nestjs/common';
import { SupportService } from './support.service';
import { SupportAttachmentService } from './support-attachment.service';
import { SupportController } from './support.controller';
import { GuestSupportController } from './guest-support.controller';
import { AdminSupportController } from './admin-support.controller';
import { EmailModule } from '../../common/email/email.module';

@Module({
  imports: [EmailModule],
  providers: [SupportService, SupportAttachmentService],
  controllers: [
    SupportController,
    GuestSupportController,
    AdminSupportController,
  ],
  exports: [SupportService],
})
export class SupportModule {}
