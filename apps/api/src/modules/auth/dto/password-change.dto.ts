import { IsString, MaxLength, MinLength } from 'class-validator';

export class PasswordChangeDto {
  @IsString()
  @MinLength(8)
  @MaxLength(256)
  currentPassword!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(256)
  newPassword!: string;
}

/**
 * First-login password set. Used by the security gate for admin-created
 * accounts: the user is already authenticated and flagged
 * securitySetupRequired, so we don't make them re-type the temporary
 * password — just a new one.
 */
export class FirstLoginPasswordDto {
  @IsString()
  @MinLength(10)
  @MaxLength(256)
  newPassword!: string;
}
