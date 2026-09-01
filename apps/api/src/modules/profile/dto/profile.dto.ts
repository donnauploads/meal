import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class UpdateProfileDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) firstName?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) lastName?: string;
  @IsOptional() @IsString() @Matches(/^@[a-z0-9_]{2,30}$/i) novaTag?: string;
  @IsOptional() @IsString() @MaxLength(280) bio?: string;
  // E.164 format (`+` then 6–15 digits). Real bank flows would gate this
  // behind a verification challenge — kept open here for demo simplicity.
  @IsOptional() @IsString() @Matches(/^\+[1-9]\d{5,14}$/) phoneE164?: string;
}

export class UpdatePreferencesDto {
  @IsOptional() @IsIn(['system', 'light', 'dark']) theme?: 'system' | 'light' | 'dark';
  @IsOptional() @IsBoolean() doNotSell?: boolean;
  @IsOptional() @IsBoolean() marketingData?: boolean;
  @IsOptional() @IsBoolean() analytics?: boolean;
  @IsOptional() @IsBoolean() shareContacts?: boolean;
}
