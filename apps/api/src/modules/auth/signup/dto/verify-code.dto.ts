import { IsString, IsUUID, Length, Matches } from 'class-validator';

export class VerifyCodeDto {
  @IsUUID()
  verificationId!: string;

  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/)
  code!: string;
}
