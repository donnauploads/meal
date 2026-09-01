import { Transform } from 'class-transformer';
import { IsDefined, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class PayDto {
  @IsUUID()
  fromAccountId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  recipientHandleOrId!: string;

  @IsDefined()
  @Transform(({ value }) => (typeof value === 'string' ? BigInt(value) : BigInt(value ?? 0)))
  amountCents!: bigint;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  note?: string;

  @IsOptional()
  @IsUUID()
  contactId?: string;
}

export class CreatePaymentRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  payerHandleOrId!: string;

  @IsDefined()
  @Transform(({ value }) => (typeof value === 'string' ? BigInt(value) : BigInt(value ?? 0)))
  amountCents!: bigint;

  @IsString()
  @MinLength(1)
  @MaxLength(280)
  note!: string;
}
