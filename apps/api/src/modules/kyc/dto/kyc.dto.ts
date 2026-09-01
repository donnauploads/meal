import { IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class RejectKycDto {
  @IsString()
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  missingFields?: string[];
}
