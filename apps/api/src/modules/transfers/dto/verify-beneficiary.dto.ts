import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class VerifyBeneficiaryDto {
  @IsEnum(['local', 'international'])
  type!: 'local' | 'international';

  @IsOptional() @IsString() @MaxLength(160) bankName?: string;
  @IsOptional() @IsString() @MaxLength(160) beneficiaryName?: string;
  @IsOptional() @IsString() @MaxLength(9) routingNumber?: string;
  @IsOptional() @IsString() @MaxLength(34) accountNumber?: string;
  @IsOptional() @IsString() @MaxLength(11) swiftBic?: string;
  @IsOptional() @IsString() @MaxLength(34) iban?: string;
}
