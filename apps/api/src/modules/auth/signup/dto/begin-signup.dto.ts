import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class BeginSignupDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lastName!: string;

  @IsEmail()
  @MaxLength(254)
  email!: string;

  /**
   * Phone in international E.164 form: leading "+", country-code digit
   * 1–9, then 6–14 more digits. Covers the entire allow-list the
   * frontend PhoneInput exposes (Americas + Europe + Asia + GCC); the
   * frontend already validates per-country format via libphonenumber-js
   * before submitting, so this regex only needs the structural shape.
   */
  @IsString()
  @Matches(/^\+[1-9]\d{6,14}$/, {
    message: 'phoneE164 must be in international E.164 format, e.g. +97336001234',
  })
  phoneE164!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9]{4,16}$/i)
  referralCode?: string;
}
