import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class StartSwitchDto {
  @IsString() @MinLength(1) @MaxLength(120) employerName!: string;
  @IsOptional() @IsString() @MaxLength(120) employerDomain?: string;
  @IsOptional() @IsUUID() employerId?: string;
}

export class ActivateWebhookDto {
  @IsString() partnerRequestId!: string;
}
