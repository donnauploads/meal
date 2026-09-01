import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsDefined, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

const toBigInt = ({ value }: { value: unknown }) =>
  value == null || value === '' ? undefined : BigInt(value as string | number);

export class CreateGoalDto {
  @IsString() @MinLength(1) @MaxLength(8) emoji!: string;
  @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @IsOptional() @Transform(toBigInt) targetCents?: bigint;
  @IsOptional() @IsDateString() targetDate?: string;
  @IsOptional() @Transform(toBigInt) contributePerWeek?: bigint;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class UpdateGoalDto {
  @IsOptional() @IsString() @MaxLength(8) emoji?: string;
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @Transform(toBigInt) targetCents?: bigint;
  @IsOptional() @IsDateString() targetDate?: string;
  @IsOptional() @Transform(toBigInt) contributePerWeek?: bigint;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class ContributeDto {
  @IsUUID()
  fromAccountId!: string;

  @IsDefined()
  @Transform(({ value }) => (typeof value === 'string' ? BigInt(value) : BigInt(value ?? 0)))
  amountCents!: bigint;
}
