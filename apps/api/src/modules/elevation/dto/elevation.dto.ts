import { IsIn, IsString, IsUUID, Length, Matches } from 'class-validator';

const SCOPES = ['card:reveal', 'wire:create', 'transfer:authorize', 'profile:edit'] as const;
type Scope = (typeof SCOPES)[number];

export class BeginElevationDto {
  @IsIn(SCOPES as unknown as readonly string[])
  scope!: Scope;
}

export class VerifyElevationDto {
  @IsUUID()
  challengeId!: string;

  @IsString()
  @Length(6, 6)
  @Matches(/^\d{6}$/)
  code!: string;

  @IsIn(SCOPES as unknown as readonly string[])
  scope!: Scope;
}
