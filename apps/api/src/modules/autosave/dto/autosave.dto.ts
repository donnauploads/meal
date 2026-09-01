import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsUUID, Max, Min, ValidateNested } from 'class-validator';

export class GoalSplitDto {
  @IsUUID()
  goalId!: string;

  @IsInt()
  @Min(0)
  @Max(100)
  percent!: number;
}

export class UpdateAutosaveDto {
  @IsOptional() @IsBoolean()
  enabled?: boolean;

  @IsOptional() @IsBoolean()
  roundUpEnabled?: boolean;

  @IsOptional() @IsUUID()
  roundUpSourceAccountId?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => GoalSplitDto)
  splits?: GoalSplitDto[];

  @IsOptional()
  @Transform(({ value }) => (value == null || value === '' ? undefined : BigInt(value as string | number)))
  weeklyContributionCents?: bigint;

  @IsOptional() @IsInt() @Min(0) @Max(6)
  weeklyDay?: number;
}
