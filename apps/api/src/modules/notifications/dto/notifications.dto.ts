import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

const toBigInt = ({ value }: { value: unknown }) =>
  value == null || value === '' ? undefined : BigInt(value as string | number);

export class ListNotificationsDto {
  @IsOptional()
  @Transform(({ value }) => (value === 'true' || value === true))
  @IsBoolean()
  unreadOnly?: boolean;

  @IsOptional()
  @Transform(({ value }) => (value == null || value === '' ? undefined : Number(value)))
  @IsInt() @Min(1) @Max(100)
  limit?: number;
}

export class UpdatePreferencesDto {
  @IsOptional() @IsBoolean() txAll?: boolean;
  @IsOptional() @IsBoolean() txLargeOnly?: boolean;
  @IsOptional() @Transform(toBigInt) txLargeThresholdCents?: bigint;
  @IsOptional() @IsBoolean() securityAlerts?: boolean;
  @IsOptional() @IsBoolean() marketingEmail?: boolean;
  @IsOptional() @IsBoolean() marketingPush?: boolean;
}
