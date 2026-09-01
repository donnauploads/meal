/**
 * Local mirrors of the Prisma `MailDesk` / `MailThreadStatus` /
 * `MailDirection` enums. They duplicate the schema's string values so the
 * mail module compiles even before `@prisma/client` is regenerated (the
 * Windows query-engine DLL is locked while the dev server runs, so a
 * `prisma generate` can only land on the next restart). The values are
 * identical to the Postgres enum labels, so writes through the
 * `as unknown as` Prisma cast accept them directly. Once the client is
 * regenerated these stay structurally compatible with the generated unions.
 */

export type MailDesk = 'customer_care' | 'administrator' | 'bank_manager';
export type MailThreadStatus = 'open' | 'closed';
export type MailDirection = 'outbound' | 'inbound';

export const MAIL_DESKS: readonly MailDesk[] = [
  'customer_care',
  'administrator',
  'bank_manager',
] as const;

export const MAIL_THREAD_STATUSES: readonly MailThreadStatus[] = [
  'open',
  'closed',
] as const;

/**
 * Untyped view of the mail Prisma models — used until the generated client
 * exposes them. Mirrors the `WithSupport` workaround in `support.service.ts`.
 */
export interface MailDb {
  mailThread: any;
  mailMessage: any;
  mailAttachment: any;
}
