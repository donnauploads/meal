import { Injectable, Logger } from '@nestjs/common';
import { EmailService } from '../../../common/email/email.service';
import { SmsProvider } from './sms.provider';

@Injectable()
export class SmsStubProvider implements SmsProvider {
  private readonly logger = new Logger('SmsStubProvider');

  constructor(private readonly email: EmailService) {}

  async send(toE164: string, body: string): Promise<void> {
    this.logger.log(`[SMS-STUB] -> ${toE164}: ${body}`);
    await this.email.send({
      to: `sms-${toE164.replace(/[^\d]/g, '')}@secure-access.site`,
      subject: `[SMS stub] ${toE164}`,
      text: body,
    });
  }
}
