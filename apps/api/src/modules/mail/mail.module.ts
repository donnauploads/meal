import { Module } from '@nestjs/common';
import { MailService } from './mail.service';
import { MailController } from './mail.controller';
import { MailWebhookController } from './mail-webhook.controller';

/**
 * Admin Mail Desk — admin-composed, two-way threaded email over Resend.
 *
 * Depends only on globally-provided services (PrismaModule, EmailModule,
 * DocumentsModule's STORAGE_DRIVER, EventEmitter), so no imports are needed.
 */
@Module({
  controllers: [MailController, MailWebhookController],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
