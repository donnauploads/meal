import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { FxService } from './fx.service';

/**
 * Read-only FX endpoints for the wire form: the supported-currency list
 * and a single-pair rate lookup (used to preview the conversion as the
 * customer types, before they commit to a full /transfers/quote).
 */
@UseGuards(JwtAccessGuard)
@Controller('fx')
export class FxController {
  constructor(private readonly fx: FxService) {}

  @Get('currencies')
  currencies() {
    return { currencies: this.fx.listCurrencies() };
  }

  @Get('rates')
  async rates(@Query('codes') codes?: string) {
    const list = codes
      ? codes.split(',').map((c) => c.trim()).filter(Boolean)
      : undefined;
    return this.fx.ratesPerUsd(list);
  }

  @Get('rate')
  async rate(@Query('from') from: string, @Query('to') to: string) {
    const r = await this.fx.getRate(from ?? 'USD', to ?? 'USD');
    return {
      from: r.from,
      to: r.to,
      rate: r.rate,
      asOf: r.asOf,
      source: r.source,
    };
  }
}
