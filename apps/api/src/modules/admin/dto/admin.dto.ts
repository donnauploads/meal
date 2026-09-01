import { Transform } from 'class-transformer';
import { IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min } from 'class-validator';
import { TransactionCategory, TransactionStatus, UserRole } from '@prisma/client';

export class SearchUsersDto {
  @IsOptional() @IsString() @MaxLength(120) q?: string;
  @IsOptional()
  @Transform(({ value }) => (value == null || value === '' ? undefined : Number(value)))
  @IsInt() @Min(1) @Max(100) limit?: number;
}

export class ChangeRoleDto {
  @IsEnum(['customer', 'admin', 'superadmin']) role!: UserRole;
  @IsString() @MaxLength(280) reason!: string;
}

export class UpdateAdminUserDto {
  @IsOptional() @IsString() @MaxLength(120) firstName?: string;
  @IsOptional() @IsString() @MaxLength(120) lastName?: string;
  /** Stored lowercased and unique. `@`-prefix is optional in input. */
  @IsOptional() @IsString() @MaxLength(32) novaTag?: string;
  /** E.164. Backend doesn't reformat — caller normalizes. */
  @IsOptional() @IsString() @MaxLength(20) phoneE164?: string;
  @IsOptional() @IsDateString() dob?: string;
  @IsOptional() @IsString() @MaxLength(254) email?: string;
  @IsOptional() @IsEnum(['customer', 'admin', 'superadmin']) role?: UserRole;
  @IsOptional() @IsEnum(['active', 'frozen', 'closed']) status?: 'active' | 'frozen' | 'closed';
  /** Required when changing role, status, or email — audit log. */
  @IsString() @MaxLength(280) reason!: string;
}

export class CreateAdminUserDto {
  @IsString() @MaxLength(254) email!: string;
  /** Temporary password the admin hands off. Hashed server-side. */
  @IsString() @Length(10, 200) password!: string;
  @IsOptional() @IsString() @MaxLength(120) firstName?: string;
  @IsOptional() @IsString() @MaxLength(120) lastName?: string;
  @IsOptional() @IsString() @MaxLength(32) novaTag?: string;
  @IsOptional() @IsString() @MaxLength(20) phoneE164?: string;
  @IsOptional() @IsEnum(['customer', 'admin', 'superadmin']) role?: UserRole;
  @IsOptional() @IsEnum(['active', 'frozen', 'closed']) status?: 'active' | 'frozen' | 'closed';
  /** Force password change + transaction PIN on first sign-in. */
  @IsOptional() @IsBoolean() requireSecuritySetup?: boolean;
  /** Required — audit log. */
  @IsString() @MaxLength(280) reason!: string;
}

export class KycDecisionDto {
  @IsEnum(['approved', 'rejected']) decision!: 'approved' | 'rejected';
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) missingFields?: string[];
}

export class DocumentDecisionDto {
  @IsEnum(['approved', 'rejected']) decision!: 'approved' | 'rejected';
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class TransferReviewDecisionDto {
  @IsEnum(['approved', 'rejected']) decision!: 'approved' | 'rejected';
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class WireBeneficiaryDto {
  @IsEnum(['local', 'international']) type!: 'local' | 'international';
  @IsString() @MaxLength(160) name!: string;
  @IsString() @MaxLength(160) bankName!: string;
  // Local
  @IsOptional() @IsString() @MaxLength(9) routingNumber?: string;
  @IsOptional() @IsString() @MaxLength(34) accountNumber?: string;
  // International
  @IsOptional() @IsString() @MaxLength(11) swiftBic?: string;
  @IsOptional() @IsString() @MaxLength(34) iban?: string;
  @IsOptional() @IsString() @MaxLength(80) country?: string;
  @IsOptional() @IsString() @MaxLength(280) beneficiaryAddress?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class ReverseWireDto {
  @IsString() @MaxLength(500) reason!: string;
}

const toBigInt = ({ value }: { value: unknown }) =>
  value == null || value === '' ? undefined : BigInt(value as string | number);

export class PatchTransactionDto {
  @IsOptional() @Transform(toBigInt) amountCents?: bigint;
  @IsOptional() @IsDateString() occurredAt?: string;
  @IsOptional() @IsString() @MaxLength(280) description?: string;
  @IsOptional() @IsEnum(['groceries','dining','transport','entertainment','shopping','bills','health','travel','utilities','transfer','income','other']) category?: TransactionCategory;
  @IsOptional() @IsEnum(['pending', 'posted', 'declined', 'reversed']) status?: TransactionStatus;
  @IsString() @MaxLength(500) reason!: string;
  @IsOptional() @IsBoolean() forceAllowNegative?: boolean;
}

export class HideTransactionDto {
  @IsString() @MaxLength(500) reason!: string;
}

export class CreateAdminTransactionDto {
  @IsUUID() accountId!: string;
  @Transform(toBigInt) @IsOptional() amountCents!: bigint;
  @IsDateString() occurredAt!: string;
  @IsString() @MaxLength(280) description!: string;
  @IsEnum(['groceries','dining','transport','entertainment','shopping','bills','health','travel','utilities','transfer','income','other']) category!: TransactionCategory;
  @IsEnum(['pending', 'posted', 'declined', 'reversed']) status!: TransactionStatus;
  @IsOptional() @IsEnum(['card_purchase','ach_in','ach_out','p2p_in','p2p_out','fee','interest','deposit','refund','adjustment']) kind?: 'card_purchase'|'ach_in'|'ach_out'|'p2p_in'|'p2p_out'|'fee'|'interest'|'deposit'|'refund'|'adjustment';
  @IsString() @MaxLength(500) reason!: string;
  @IsOptional() @IsBoolean() forceAllowNegative?: boolean;
}

export class DeleteAdminTransactionDto {
  @IsString() @MaxLength(500) reason!: string;
}

export class BulkShiftDto {
  @IsArray() @IsUUID('all', { each: true }) transactionIds!: string[];
  @IsInt() shiftDays!: number;
  @IsString() @MaxLength(500) reason!: string;
}

export class ListAdminTransactionsDto {
  @IsOptional() @IsUUID() userId?: string;
  @IsOptional() @IsUUID() accountId?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsString() @MaxLength(64) cursor?: string;
  @IsOptional()
  @Transform(({ value }) => (value == null || value === '' ? undefined : Number(value)))
  @IsInt() @Min(1) @Max(100) limit?: number;
}
