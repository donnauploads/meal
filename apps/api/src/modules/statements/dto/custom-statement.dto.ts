import { Transform } from 'class-transformer';
import { IsDate, IsUUID } from 'class-validator';

export class CustomStatementDto {
  @IsUUID()
  accountId!: string;

  @Transform(({ value }) => (value instanceof Date ? value : new Date(value)))
  @IsDate()
  periodStart!: Date;

  @Transform(({ value }) => (value instanceof Date ? value : new Date(value)))
  @IsDate()
  periodEnd!: Date;
}
