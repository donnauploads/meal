import { IsIn } from 'class-validator';

export class SendVerificationDto {
  @IsIn(['email', 'sms'])
  channel!: 'email' | 'sms';
}
