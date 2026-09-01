import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateContactDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsOptional() @IsString() @Matches(/^@[a-z0-9_]{2,30}$/i) handle?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @Matches(/^\+1\d{10}$/) phoneE164?: string;
  @IsOptional() @IsString() @MaxLength(512) avatarUrl?: string;
}

export class UpdateContactDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsString() @Matches(/^@[a-z0-9_]{2,30}$/i) handle?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @Matches(/^\+1\d{10}$/) phoneE164?: string;
  @IsOptional() @IsString() @MaxLength(512) avatarUrl?: string;
}
