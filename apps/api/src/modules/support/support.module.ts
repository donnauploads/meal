import { Module } from '@nestjs/common';
import { SupportService } from './support.service';
import { SupportController } from './support.controller';
import { GuestSupportController } from './guest-support.controller';
import { AdminSupportController } from './admin-support.controller';
import { EmailModule } from '../../common/email/email.module';

@Module({
  imports: [EmailModule],
  providers: [SupportService],
  controllers: [
    SupportController,
    GuestSupportController,
    AdminSupportController,
  ],
  exports: [SupportService],
})
export class SupportModule {}
