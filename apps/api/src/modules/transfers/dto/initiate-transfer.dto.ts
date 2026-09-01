import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDefined,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { TransferKind } from '@prisma/client';

export class WireDetailsDto {
  @IsEnum(['local', 'international']) type!: 'local' | 'international';
  @IsString() @MaxLength(160) beneficiaryName!: string;
  @IsString() @MaxLength(160) bankName!: string;
  @IsOptional() @IsString() @MaxLength(9) routingNumber?: string;
  @IsOptional() @IsString() @MaxLength(34) accountNumber?: string;
  @IsOptional() @IsString() @MaxLength(11) swiftBic?: string;
  @IsOptional() @IsString() @MaxLength(34) iban?: string;
  @IsOptional() @IsString() @MaxLength(80) country?: string;
}

export class InitiateTransferDto {
  @IsUUID()
  fromAccountId!: string;

  @IsOptional()
  @IsUUID()
  toAccountId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  externalRef?: string;

  @IsEnum(['internal', 'ach_in', 'ach_out', 'wire_in', 'wire_out', 'p2p'])
  kind!: TransferKind;

  @IsDefined()
  @Transform(({ value }) => (typeof value === 'string' ? BigInt(value) : BigInt(value ?? 0)))
  amountCents!: bigint;

  @IsOptional()
  @IsBoolean()
  instant?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  note?: string;

  /** Required when `kind === 'wire_out'`. Must match an admin-approved
   *  WireBeneficiary row, otherwise the transfer is rejected. */
  @IsOptional()
  @ValidateNested()
  @Type(() => WireDetailsDto)
  wireDetails?: WireDetailsDto;

  /** FX: the currency the customer is sending in (e.g. "BHD"). When set
   *  and not USD, the backend converts `sendAmountMinor` → USD at submit
   *  time and settles/debits that USD amount; `amountCents` is ignored. */
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
