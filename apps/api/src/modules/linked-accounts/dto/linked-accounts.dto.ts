import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ExchangeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  publicToken!: string;
}

export class InstitutionSearchDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;
}
