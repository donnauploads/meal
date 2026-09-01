import { IsEmail, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CreateInviteDto {
  @IsOptional() @IsEmail() invitedEmail?: string;
}

export class AttachReferralDto {
  @IsString()
  @Matches(/^[A-Z0-9]{4,16}$/i)
  @MaxLength(16)
  code!: string;
}
