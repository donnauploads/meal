import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Exclude } from 'class-transformer';

export class DobDto {
  @IsDateString()
  dob!: string;
}

export class CardChoiceDto {
  @IsIn(['checking', 'savings', 'credit'])
  cardChoice!: 'checking' | 'savings' | 'credit';
}

export class AddressDto {
  @IsString() @MaxLength(120) street!: string;
  @IsOptional() @IsString() @MaxLength(40) apt?: string;
  @IsString() @MaxLength(80) city!: string;
  @IsString() @Length(2, 2) state!: string;
  @IsString() @Matches(/^\d{5}(-\d{4})?$/) zip!: string;
}

export class PasswordDto {
  @IsString() @MinLength(10) @MaxLength(256) password!: string;
}

export class DetailsDto {
  @IsOptional() @IsString() @MaxLength(120) income?: string;
  @IsOptional() @IsString() @MaxLength(120) occupation?: string;
  @IsOptional() @IsString() @MaxLength(120) annualIncome?: string;
  @IsOptional() @IsString() @MaxLength(120) payMethod?: string;
  @IsOptional() @IsString() @MaxLength(120) foundUs?: string;
  @IsOptional() @IsBoolean() marketingConsent?: boolean;
}

/**
 * National-ID DTO. Repurposed from the legacy SSN field — the DB column
 * names (ssnHash, ssnEncrypted) stayed for backwards compatibility but
 * the value is now a Passport ID number: uppercase alphanumeric, 6–9
 * chars per ICAO 9303 (machine-readable zone) typical length.
 *
 * The trailing `ssn!: string` property name + the controller wiring
 * remain so existing call sites compile without churn.
 */
export class SsnDto {
  @Exclude({ toPlainOnly: true })
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : '',
  )
  @Matches(/^[A-Z0-9]{6,9}$/, {
    message: 'Passport ID must be 6–9 uppercase letters/digits',
  })
  ssn!: string;
}
