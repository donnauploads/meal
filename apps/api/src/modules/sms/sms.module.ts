import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SMS_PROVIDER } from '../mfa/providers/sms.provider';
import { SmsStubProvider } from '../mfa/providers/sms-stub.provider';
import { TwilioSmsProvider } from './providers/twilio.provider';

@Global()
@Module({
  providers: [
    SmsStubProvider,
    TwilioSmsProvider,
    {
      provide: SMS_PROVIDER,
      inject: [ConfigService, SmsStubProvider, TwilioSmsProvider],
      useFactory: (config: ConfigService, stub: SmsStubProvider, twilio: TwilioSmsProvider) =>
        (config.get<string>('SMS_PROVIDER') ?? 'stub').toLowerCase() === 'twilio' ? twilio : stub,
    },
  ],
  exports: [SMS_PROVIDER],
})
export class SmsModule {}
