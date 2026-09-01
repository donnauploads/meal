import { IsString } from 'class-validator';

export class MfaResendDto {
  @IsString()
  mfaToken!: string;
}
