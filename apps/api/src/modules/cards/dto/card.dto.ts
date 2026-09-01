import { IsObject, IsOptional, IsUUID } from 'class-validator';

export class OrderCardDto {
  @IsUUID()
  accountId!: string;

  @IsObject()
  shipAddress!: Record<string, string>;
}

export class ActivateCardDto {
  @IsOptional()
  last4?: string;
}
