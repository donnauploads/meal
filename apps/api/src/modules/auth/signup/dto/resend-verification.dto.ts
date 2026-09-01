import { IsUUID } from 'class-validator';

export class ResendVerificationDto {
  @IsUUID()
  verificationId!: string;
}
