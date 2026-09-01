import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { TransfersService } from './transfers.service';
import { QuoteDto } from './dto/quote.dto';
import { InitiateTransferDto } from './dto/initiate-transfer.dto';
import { VerifyBeneficiaryDto } from './dto/verify-beneficiary.dto';
import {
  ElevationGuard,
  RequiresElevation,
} from '../elevation/elevation.guard';

@UseGuards(JwtAccessGuard, ElevationGuard)
@Controller('transfers')
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @Post('quote')
  // Quoting is read-only — no elevation required so the FE can show
  // fees (and the live FX conversion for cross-currency wires) before the
  // customer is asked for their PIN.
  quote(@Body() dto: QuoteDto) {
    return this.transfers.quoteForRequest(dto);
  }

  @Post('verify-beneficiary')
  // Read-only beneficiary lookup for the wire form's live validation. No
  // elevation required — it moves no money, just confirms the entered
  // routing/account (or SWIFT/IBAN) matches an approved beneficiary at the
  // named bank.
  verifyBeneficiary(@Body() dto: VerifyBeneficiaryDto) {
    return this.transfers.verifyBeneficiary(dto);
  }

  @Post()
  // Money movement requires a valid `x-elevation` token. See PayController
  // for the rationale — PIN/biometric verification is the gate.
  @RequiresElevation('transfer:authorize')
  initiate(
    @CurrentUser() user: CurrentUserPayload,
    @Headers('idempotency-key') idempotencyKey: string,
    @Body() dto: InitiateTransferDto,
  ) {
    return this.transfers.initiate(user.sub, idempotencyKey, dto);
  }

  @Get()
  async list(@CurrentUser() user: CurrentUserPayload) {
    const rows = await this.transfers.list(user.sub);
    return rows.map((t) => ({
      id: t.id,
      kind: t.kind,
      status: t.status,
      amountCents: t.amountCents.toString(),
      feeCents: t.feeCents.toString(),
      fromAccountId: t.fromAccountId,
      toAccountId: t.toAccountId,
      instant: t.instant,
      initiatedAt: t.initiatedAt.toISOString(),
      settledAt: t.settledAt ? t.settledAt.toISOString() : null,
    }));
  }

  /**
   * Ops rescue — re-enqueue settlement for a transfer that got stuck in
   * `pending` (Redis was down at init, worker crashed, DB hand-edits).
   * Owner-only: customer can poke their own transfers without needing
   * an admin to intervene.
   */
  @Post(':id/force-settle')
  async forceSettle(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    // Ownership check via the same path the GET uses.
    await this.transfers.getForUser(user.sub, id);
    return this.transfers.forceSettle(id);
  }

  @Get(':id')
  async get(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    const t = await this.transfers.getForUser(user.sub, id);
    return {
      id: t.id,
      kind: t.kind,
      status: t.status,
      amountCents: t.amountCents.toString(),
      feeCents: t.feeCents.toString(),
      fromAccountId: t.fromAccountId,
      toAccountId: t.toAccountId,
      instant: t.instant,
      initiatedAt: t.initiatedAt.toISOString(),
      settledAt: t.settledAt ? t.settledAt.toISOString() : null,
      failureReason: t.failureReason,
    };
  }
}
