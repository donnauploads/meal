import { IsString, Length, Matches } from 'class-validator';

export class TotpVerifyDto {
  @IsString() @Length(6, 6) @Matches(/^\d{6}$/) code!: string;
}

export class TotpDisableDto {
  @IsString() @Length(6, 6) @Matches(/^\d{6}$/) currentCode!: string;
}
