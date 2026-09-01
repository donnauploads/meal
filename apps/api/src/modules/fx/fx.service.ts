import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  CURRENCY_DECIMALS,
  CurrencyCode,
  PEG_RATES_PER_USD,
  SUPPORTED_CURRENCIES,
  isSupportedCurrency,
} from './fx.constants';

export type RateSource = 'live' | 'peg';

export interface FxRate {
  from: CurrencyCode;
  to: CurrencyCode;
  /** Units of `to` per 1 unit of `from`. */
  rate: number;
  /** ISO timestamp the underlying rate table was produced. */
  asOf: string;
  source: RateSource;
}

export interface FxConversion extends FxRate {
  fromAmountMinor: bigint;
  toAmountMinor: bigint;
}

interface RateTable {
  /** Units per 1 USD, keyed by currency. */
  perUsd: Record<string, number>;
  asOf: string;
  source: RateSource;
}

/**
 * Foreign-exchange rates for wire conversion. The ledger is USD; this
 * service only converts a wire's customer-facing send currency to/from
 * USD so the right amount is debited and shown.
 *
 * Reliability: live rates are pulled from `open.er-api.com` (free, no
 * key, USD-based) and cached in-memory for an hour. Every lookup falls
 * back to the pegged table (`PEG_RATES_PER_USD`) when the feed is stale,
 * unreachable, or missing a currency — so a rate is ALWAYS returned and
 * the Gulf pegs stay exact even offline.
 */
@Injectable()
export class FxService {
  private readonly logger = new Logger(FxService.name);
  private readonly ttlMs = 60 * 60 * 1000; // 1 hour
  private readonly endpoint = 'https://open.er-api.com/v6/latest/USD';

  private cache: RateTable | null = null;
  private fetchedAtMs = 0;
  private inflight: Promise<RateTable> | null = null;

  /** The pegged fallback as a RateTable (asOf "now" is meaningless for a
   *  peg, so we stamp it epoch to signal "not a live quote"). */
  private pegTable(): RateTable {
    return {
      perUsd: { ...PEG_RATES_PER_USD },
      asOf: new Date(0).toISOString(),
      source: 'peg',
    };
  }

  private cacheFresh(): boolean {
    return this.cache != null && Date.now() - this.fetchedAtMs < this.ttlMs;
  }

  /** Fetch + cache the live USD table; collapse concurrent calls into one
   *  request; never throw — fall back to the peg table on any failure. */
  private async loadTable(): Promise<RateTable> {
    if (this.cacheFresh() && this.cache) return this.cache;
    if (this.inflight) return this.inflight;

    this.inflight = (async (): Promise<RateTable> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      try {
        const res = await fetch(this.endpoint, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as {
          result?: string;
          rates?: Record<string, number>;
          time_last_update_utc?: string;
        };
        if (json.result !== 'success' || !json.rates?.USD) {
          throw new Error('unexpected payload');
        }
        const table: RateTable = {
          perUsd: json.rates,
          asOf: json.time_last_update_utc
            ? new Date(json.time_last_update_utc).toISOString()
            : new Date().toISOString(),
          source: 'live',
        };
        this.cache = table;
        this.fetchedAtMs = Date.now();
        return table;
      } catch (err) {
        this.logger.warn(
          `live FX fetch failed (${(err as Error).message}); using pegged fallback`,
        );
        // Cache the peg briefly too so we don't hammer a dead endpoint.
        this.cache = this.pegTable();
        this.fetchedAtMs = Date.now();
        return this.cache;
      } finally {
        clearTimeout(timer);
        this.inflight = null;
      }
    })();

    return this.inflight;
  }

  private assertCurrency(code: string): CurrencyCode {
    if (!isSupportedCurrency(code)) {
      throw new BadRequestException(`UNSUPPORTED_CURRENCY:${code}`);
    }
    return code;
  }

  /** Units of `to` per 1 unit of `from`, with the rate's provenance. */
  async getRate(fromRaw: string, toRaw: string): Promise<FxRate> {
    const from = this.assertCurrency(fromRaw);
    const to = this.assertCurrency(toRaw);
    if (from === to) {
      return { from, to, rate: 1, asOf: new Date().toISOString(), source: 'peg' };
    }

    const table = await this.loadTable();
    // Cross rate via USD. If the live table is missing a currency, fall
    // back to that currency's peg so we never return NaN.
    const perUsd = (c: CurrencyCode): { v: number; pegged: boolean } => {
      const live = table.perUsd[c];
      if (typeof live === 'number' && live > 0 && table.source === 'live') {
        return { v: live, pegged: false };
      }
      return { v: PEG_RATES_PER_USD[c], pegged: true };
    };

    const f = perUsd(from);
    const t = perUsd(to);
    const rate = t.v / f.v;
    const pegged = table.source === 'peg' || f.pegged || t.pegged;
    return {
      from,
      to,
      rate,
      asOf: pegged ? new Date(0).toISOString() : table.asOf,
      source: pegged ? 'peg' : 'live',
    };
  }

  /** Convert an amount in `from` minor units to `to` minor units, honouring
   *  each currency's decimal places. Returns the applied rate + provenance
   *  so the caller can lock + display it. */
  async convert(
    fromAmountMinor: bigint,
    fromRaw: string,
    toRaw: string,
  ): Promise<FxConversion> {
    const r = await this.getRate(fromRaw, toRaw);
    const fromMajor =
      Number(fromAmountMinor) / 10 ** CURRENCY_DECIMALS[r.from];
    const toMajor = fromMajor * r.rate;
    const toAmountMinor = BigInt(
      Math.round(toMajor * 10 ** CURRENCY_DECIMALS[r.to]),
    );
    return { ...r, fromAmountMinor, toAmountMinor };
  }

  /**
   * Bulk "units per 1 USD" table for a set of currencies (defaults to all
   * supported). Backs the customer dashboard's display-currency conversion so
   * balances are shown at the same live rate the wire flow settles at — one
   * source of truth across the platform. Unknown codes are ignored; any
   * currency missing from the live feed falls back to its peg.
   */
  async ratesPerUsd(codesRaw?: string[]): Promise<{
    base: 'USD';
    rates: Record<string, number>;
    asOf: string;
    source: RateSource;
  }> {
    const codes = (
      codesRaw && codesRaw.length ? codesRaw : [...SUPPORTED_CURRENCIES]
    )
      .map((c) => c.toUpperCase())
      .filter(isSupportedCurrency) as CurrencyCode[];

    const table = await this.loadTable();
    const rates: Record<string, number> = {};
    for (const c of codes) {
      const live = table.perUsd[c];
      rates[c] =
        table.source === 'live' && typeof live === 'number' && live > 0
          ? live
          : PEG_RATES_PER_USD[c];
    }
    return {
      base: 'USD',
      rates,
      asOf: table.source === 'live' ? table.asOf : new Date(0).toISOString(),
      source: table.source,
    };
  }

  listCurrencies() {
    return SUPPORTED_CURRENCIES.map((code) => ({
      code,
      decimals: CURRENCY_DECIMALS[code],
    }));
  }
}
