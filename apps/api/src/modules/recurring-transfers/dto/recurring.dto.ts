import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsEnum,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { RecurringFrequency } from '@prisma/client';

export class CreateRecurringDto {
  @IsUUID()
  fromAccountId!: string;

  @IsUUID()
  toAccountId!: string;

  // `@IsDefined()` keeps the field from being stripped by the global
  // ValidationPipe's whitelist — without a class-validator decorator
  // the pipe drops `@Transform`-only props. `@IsDefined()` runs after
  // `@Transform` (so it sees the bigint, not the original string) and
  // just asserts the value isn't null/undefined.
  @IsDefined()
  @Transform(({ value }) => (typeof value === 'string' ? BigInt(value) : BigInt(value ?? 0)))
  amountCents!: bigint;

  @IsEnum(['weekly', 'biweekly', 'monthly'])
  frequency!: RecurringFrequency;

  @IsInt()
  @Min(0)
  @Max(31)
  dayOf!: number;
}

export class UpdateRecurringDto {
  @IsOptional() @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsDefined()
  @Transform(({ value }) => (typeof value === 'string' ? BigInt(value) : value != null ? BigInt(value) : undefined))
  amountCents?: bigint;

  @IsOptional()
  @IsEnum(['weekly', 'biweekly', 'monthly'])
  frequency?: RecurringFrequency;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(31)
  dayOf?: number;
}
