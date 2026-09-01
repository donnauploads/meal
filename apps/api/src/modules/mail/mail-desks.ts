import { MailDesk } from './mail.types';

/**
 * Sender identities ("desks") an admin can send from. Each maps to a
 * verified From: address on the Resend sending domain plus a display name.
 * All three live on the same verified domain, so verifying e.g. `cbbank.bh`
 * once enables every desk.
 *
 * Addresses + names are env-overridable so staging can point at a test
 * domain without code changes:
 *
 *   MAIL_DESK_CARE_FROM    / MAIL_DESK_CARE_NAME
 *   MAIL_DESK_ADMIN_FROM   / MAIL_DESK_ADMIN_NAME
 *   MAIL_DESK_MANAGER_FROM / MAIL_DESK_MANAGER_NAME
 */

export interface DeskIdentity {
  desk: MailDesk;
  /** Bare email, e.g. `care@cbbank.bh`. */
  fromEmail: string;
  /** Display name, e.g. `State Bank Customer Care`. */
  fromName: string;
  /** Human label for the dashboard desk picker. */
  label: string;
}

const env = (k: string): string | undefined => {
  const v = process.env[k];
  return v && v.trim() ? v.trim() : undefined;
};

/** Resolve the full desk identity table from env (with sensible defaults). */
export function getDeskIdentities(): Record<MailDesk, DeskIdentity> {
  return {
    customer_care: {
      desk: 'customer_care',
      fromEmail: env('MAIL_DESK_CARE_FROM') ?? 'care@secure-access.site',
      fromName: env('MAIL_DESK_CARE_NAME') ?? 'State Bank — Customer Care',
      label: 'Customer Care',
    },
    administrator: {
      desk: 'administrator',
      fromEmail: env('MAIL_DESK_ADMIN_FROM') ?? 'admin@secure-access.site',
      fromName: env('MAIL_DESK_ADMIN_NAME') ?? 'State Bank — Administration',
      label: 'Administrator',
    },
    bank_manager: {
      desk: 'bank_manager',
      fromEmail: env('MAIL_DESK_MANAGER_FROM') ?? 'manager@secure-access.site',
      fromName: env('MAIL_DESK_MANAGER_NAME') ?? 'State Bank — Office of the Manager',
      label: 'Bank Manager',
    },
  };
}

/** Look up one desk identity. Throws on an unknown desk value. */
export function getDeskIdentity(desk: MailDesk): DeskIdentity {
  const identity = getDeskIdentities()[desk];
  if (!identity) throw new Error(`Unknown mail desk: ${desk}`);
  return identity;
}

/** Format a desk into an RFC 5322 From: header value. */
export function deskFromHeader(desk: MailDesk): string {
  const { fromName, fromEmail } = getDeskIdentity(desk);
  return `${fromName} <${fromEmail}>`;
}
