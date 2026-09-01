/**
 * Single source of truth for the app / bank name on the BACKEND.
 *
 * Used by email templates, WebAuthn RP name, TOTP issuer, etc. Override with
 * the APP_NAME env var (validated in config/env.validation.ts); otherwise it
 * falls back to the default below.
 */
export const APP_NAME = process.env.APP_NAME || 'State Bank';
