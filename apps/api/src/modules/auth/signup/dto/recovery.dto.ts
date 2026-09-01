import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RecoverRequestDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class RecoverVerifyDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'Code must be 6 digits' })
  code!: string;
}

export class RecoverResetDto {
  @IsString()
  token!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(256)
  newPassword!: string;
}
