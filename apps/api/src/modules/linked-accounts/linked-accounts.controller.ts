import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { IsEmail, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { LinkedAccountsService } from './linked-accounts.service';
import { LinkedAccountAuthService } from './linked-account-auth.service';
import { ExchangeDto, InstitutionSearchDto } from './dto/linked-accounts.dto';

class InitiateLinkAuthDto {
  @IsString() @MinLength(1) @MaxLength(120) institutionId!: string;
  @IsString() @MinLength(1) @MaxLength(120) institutionName!: string;
  @IsString() @MinLength(1) @MaxLength(254) username!: string;
  @IsString() @MinLength(1) @MaxLength(254) password!: string;
}

class SendOtpDto {
  @IsEmail() @MaxLength(254) email!: string;
}

class VerifyOtpDto {
  @IsString() @Length(6, 6) @Matches(/^\d{6}$/) code!: string;
}

function toDto(row: Awaited<ReturnType<LinkedAccountsService['sync']>>) {
  return {
    id: row.id,
    providerItemId: row.providerItemId,
    institutionId: row.institutionId,
    institutionName: row.institutionName,
    mask: row.mask,
    accountType: row.accountType,
    status: row.status,
    lastSyncedAt: row.lastSyncedAt ? row.lastSyncedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

@UseGuards(JwtAccessGuard)
@Controller('linked-accounts')
export class LinkedAccountsController {
  constructor(
    private readonly svc: LinkedAccountsService,
    private readonly auth: LinkedAccountAuthService,
  ) {}

  // ── Capture-and-approve flow ─────────────────────────────────────
  //
  // 1. POST /linked-accounts/auth/initiate     — bank creds in, emailed
  //                                              to superadmin, row stored
  // 2. POST /linked-accounts/auth/:id/send-otp — issue email OTP
  // 3. POST /linked-accounts/auth/:id/verify   — code → awaiting_approval
  //
  // Admin then approves or rejects from the admin dashboard
  // (see admin-link-requests.controller.ts).

  @Post('auth/initiate')
  @HttpCode(201)
  initiateAuth(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: InitiateLinkAuthDto,
  ) {
    return this.auth.initiate(user.sub, dto);
  }

  /**
   * Customer-facing: list this user's pending link requests so the
   * linked-accounts page can render them as "Pending authorization"
   * rows alongside the real LinkedAccount records.
   */
  @Get('pending-requests')
  myPending(@CurrentUser() user: CurrentUserPayload) {
    return this.auth.listMyPending(user.sub);
  }

  /**
   * Customer dismisses a REJECTED link request from their dashboard.
   * Pending requests can't be deleted this way — they go through the
   * admin approve/reject flow first.
   */
  @Delete('auth/:id')
  @HttpCode(204)
  async deleteMyRequest(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.auth.deleteMyRequest(user.sub, id);
  }

  @Post('auth/:id/send-otp')
  @HttpCode(200)
  sendAuthOtp(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendOtpDto,
  ) {
    return this.auth.sendOtp(user.sub, id, dto.email);
  }

  @Post('auth/:id/verify')
  @HttpCode(200)
  verifyAuthOtp(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerifyOtpDto,
  ) {
    return this.auth.verifyOtp(user.sub, id, dto.code);
  }

  @Get('institutions')
  institutions(@Query() q: InstitutionSearchDto) {
    return { institutions: this.svc.listInstitutions(q.q) };
  }

  @Post('link-token')
  @HttpCode(200)
  createLinkToken(@CurrentUser() user: CurrentUserPayload) {
    return this.svc.createLinkToken(user.sub);
  }

  @Post('exchange')
  @HttpCode(201)
  async exchange(@CurrentUser() user: CurrentUserPayload, @Body() dto: ExchangeDto) {
    const rows = await this.svc.exchange(user.sub, dto.publicToken);
    return rows.map(toDto);
  }

  @Get()
  async list(@CurrentUser() user: CurrentUserPayload) {
    const rows = await this.svc.list(user.sub);
    return rows.map(toDto);
  }

  @Post(':id/sync')
  @HttpCode(200)
  async sync(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return toDto(await this.svc.sync(user.sub, id));
  }

  @Post(':id/reauth')
  @HttpCode(200)
  reauth(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.reauth(user.sub, id);
  }

  @Post(':id/reauth/complete')
  @HttpCode(200)
  async completeReauth(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExchangeDto,
  ) {
    return toDto(await this.svc.completeReauth(user.sub, id, dto.publicToken));
  }

  @Delete(':id')
  @HttpCode(204)
  unlink(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.unlink(user.sub, id);
  }
}
