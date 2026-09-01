import { Transform } from 'class-transformer';
import { IsBoolean, IsDefined, IsEnum, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { TransferKind } from '@prisma/client';

export class QuoteDto {
  @IsUUID()
  fromAccountId!: string;

  @IsOptional()
  @IsUUID()
  toAccountId?: string;

  @IsOptional()
  @IsString()
  externalRef?: string;

  @IsEnum(['internal', 'ach_in', 'ach_out', 'wire_in', 'wire_out', 'p2p'])
  kind!: TransferKind;

  @IsDefined()
  @Transform(({ value }) => (typeof value === 'string' ? BigInt(value) : BigInt(value ?? 0)))
  amountCents!: bigint;

  @IsOptional()
  @IsBoolean()
  instant?: boolean;

  /** Only meaningful when `kind === 'wire_out'`. Picks the wire fee. */
  @IsOptional()
  @IsIn(['domestic', 'international'])
  wireScope?: 'domestic' | 'international';

  /** FX: the currency the customer is sending in (e.g. "BHD"). When set
   *  and not USD, the backend converts `sendAmountMinor` → USD settlement
   *  and ignores `amountCents`. */
  @IsOptional()
  @IsString()
  sendCurrency?: string;

  /** FX: send amount in `sendCurrency` minor units (e.g. fils for BHD). */
  @IsOptional()
  @Transform(({ value }) =>
    value == null || value === '' ? undefined : BigInt(value),
  )
  sendAmountMinor?: bigint;
}
