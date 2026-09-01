/**
 * Currency metadata + a pegged-rate fallback table for the FX service.
 *
 * The app's ledger is denominated in USD; FX only bridges the customer-
 * facing *send* currency of a wire to that USD settlement amount. Live
 * rates come from `open.er-api.com` (USD-based); this table is the
 * always-available fallback when the network is unreachable.
 *
 * Several of these are HARD PEGS published by their central banks
 * (BHD/SAR/AED/OMR/QAR/JOD/KWD to the USD), so the fallback is exact for
 * the Gulf currencies that matter most to a Bahrain bank. The floating
 * ones (EUR/GBP) are approximate and only used if the live feed is down.
 */

/** ISO-4217 codes we support as a wire's send currency. USD is the
 *  settlement (ledger) currency and always present. */
export const SUPPORTED_CURRENCIES = [
  'USD',
  'BHD',
  'SAR',
  'AED',
  'KWD',
  'OMR',
  'QAR',
  'JOD',
  'EUR',
  'GBP',
  'CNY',
] as const;

export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

export function isSupportedCurrency(code: string): code is CurrencyCode {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(code);
}

/** Minor-unit exponent per currency. BHD/KWD/OMR/JOD are 3-decimal
 *  (1000 fils/dinar); the rest are 2-decimal. */
export const CURRENCY_DECIMALS: Record<CurrencyCode, number> = {
  USD: 2,
  BHD: 3,
  SAR: 2,
  AED: 2,
  KWD: 3,
  OMR: 3,
  QAR: 2,
  JOD: 3,
  EUR: 2,
  GBP: 2,
  CNY: 2,
};

/**
 * Fallback rates expressed as "units of this currency per 1 USD".
 * Gulf values are the official pegs; EUR/GBP are rough placeholders only
 * used when the live feed can't be reached.
 */
export const PEG_RATES_PER_USD: Record<CurrencyCode, number> = {
  USD: 1,
  BHD: 0.376, // pegged
  SAR: 3.75, // pegged
  AED: 3.6725, // pegged
  KWD: 0.3072, // ~dinar basket peg
  OMR: 0.3845, // pegged
  QAR: 3.64, // pegged
  JOD: 0.709, // pegged
  EUR: 0.92, // floating (approx)
  GBP: 0.79, // floating (approx)
  CNY: 7.2, // floating (approx)
};
