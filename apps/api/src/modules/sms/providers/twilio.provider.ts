import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SmsProvider } from '../../mfa/providers/sms.provider';

@Injectable()
export class TwilioSmsProvider implements SmsProvider {
  private readonly logger = new Logger(TwilioSmsProvider.name);
  private readonly from: string;
  private client?: ReturnType<typeof import('twilio')>;

  constructor(private readonly config: ConfigService) {
    this.from = config.get<string>('TWILIO_FROM') ?? '';
  }

  private async getClient() {
    if (this.client) return this.client;
    const twilio = (await import('twilio')).default;
    const sid = this.config.get<string>('TWILIO_ACCOUNT_SID');
    const token = this.config.get<string>('TWILIO_AUTH_TOKEN');
    if (!sid || !token) throw new Error('Twilio credentials not configured');
    this.client = twilio(sid, token);
    return this.client;
  }

  async send(toE164: string, body: string): Promise<void> {
    const client = await this.getClient();
    await client.messages.create({ to: toE164, from: this.from, body });
  }
}
