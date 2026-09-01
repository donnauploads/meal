import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';
import { EMAIL_PROVIDER } from './providers/email.provider.interface';
import { NodemailerEmailProvider } from './providers/nodemailer.provider';
import { ResendEmailProvider } from './providers/resend.provider';

/**
 * Picks the email provider at boot:
 *
 *   EMAIL_PROVIDER=resend     → Resend HTTPS API (works on Railway/Render
 *                                where outbound SMTP is blocked).
 *   EMAIL_PROVIDER=nodemailer → SMTP via nodemailer (default).
 *   <unset>                   → auto: Resend if RESEND_API_KEY is present,
 *                                else nodemailer.
 */
@Global()
@Module({
  providers: [
    {
      provide: EMAIL_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const logger = new Logger('EmailModule');
        const explicit = (config.get<string>('EMAIL_PROVIDER') ?? '')
          .trim()
          .toLowerCase();
        const hasResendKey = !!config.get<string>('RESEND_API_KEY');
        const pick =
          explicit ||
          (hasResendKey ? 'resend' : 'nodemailer');

        if (pick === 'resend') {
          logger.log('Using Resend HTTPS email provider.');
          return new ResendEmailProvider(config);
        }
        logger.log('Using nodemailer SMTP email provider.');
        return new NodemailerEmailProvider(config);
      },
    },
    EmailService,
  ],
  exports: [EmailService],
})
export class EmailModule {}
