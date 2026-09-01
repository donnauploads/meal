/**
 * Render-only smoke test for the 12 email templates.
 *
 * Usage from `backend/apps/api/`:
 *
 *   # Dump every template's HTML to ./out-emails/<id>.html (default):
 *   pnpm exec ts-node src/scripts/render-email-templates.ts
 *
 *   # Send one template to your inbox via the same EmailService Nest uses
 *   # (requires .env's RESEND_API_KEY / SMTP creds to be valid):
 *   pnpm exec ts-node src/scripts/render-email-templates.ts send signup you@example.com
 *
 *   # Send ALL templates back-to-back:
 *   pnpm exec ts-node src/scripts/render-email-templates.ts send all you@example.com
 *
 * Each template is rendered with realistic sample variables that match the
 * existing builder signatures — no real accounts are touched and no
 * database is read.
 */

import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';

import { buildVerificationCodeEmail } from '../modules/verification/templates/verification-code.email';
import { buildWelcomeUserEmail } from '../modules/auth/notifications/templates/welcome-user.email';
import { buildSigninAlertEmail } from '../modules/auth/notifications/templates/signin-alert.email';
import { buildCheckDepositApprovedEmail } from '../modules/check-deposits/templates/check-deposit-approved.email';
import { buildCheckDepositDeclinedEmail } from '../modules/check-deposits/templates/check-deposit-declined.email';
import { buildWireApprovedEmail } from '../modules/transfers/templates/wire-approved.email';
import { buildWireDeclinedEmail } from '../modules/transfers/templates/wire-declined.email';
import { buildTransferSentEmail } from '../modules/transfers/templates/transfer-sent.email';
import { buildTransferDeclinedEmail } from '../modules/transfers/templates/transfer-declined.email';
import { buildLinkedApprovedEmail } from '../modules/linked-accounts/templates/linked-approved.email';
import { buildCardLinkedEmail } from '../modules/linked-accounts/templates/card-linked.email';

const WEB = process.env.WEB_BASE_URL ?? 'https://secure-access.site';
const TS_DEPOSIT = new Date('2026-06-02T09:14:00Z');
const TS_APPROVED = new Date('2026-06-02T11:47:00Z');
const TS_REVIEWED = new Date('2026-06-02T12:02:00Z');
const TS_SUBMITTED = new Date('2026-06-02T10:22:00Z');
const TS_WIRE_APPROVED = new Date('2026-06-02T13:48:00Z');
const TS_SENT = new Date('2026-06-02T19:42:00Z');
const TS_ATTEMPTED = new Date('2026-06-02T21:05:00Z');
const TS_LINK = new Date('2026-06-02T10:00:00Z');
const TS_SIGNIN = new Date('2026-06-02T14:32:00Z');

const TEMPLATES: Record<string, () => { subject: string; text: string; html?: string }> = {
  // 1. SIGN-UP VERIFICATION CODE
  signup: () =>
    buildVerificationCodeEmail({ code: '482913', ttlMinutes: 10, kind: 'signup' }),

  // 2. SIGN-IN VERIFICATION CODE
  login: () =>
    buildVerificationCodeEmail({ code: '730514', ttlMinutes: 5, kind: 'signin' }),

  // 3. REGISTRATION SUCCESSFUL
  welcome: () =>
    buildWelcomeUserEmail({
      firstName: 'Layla',
      webBaseUrl: WEB,
      applicationRef: 'State Bank-2026-4471',
      submittedAt: new Date('2026-06-02T14:08:00Z'),
      typicalDecisionTime: '1 business day',
    }),

  // 4. NEW SIGN-IN NOTIFICATION
  alert: () =>
    buildSigninAlertEmail({
      firstName: 'Layla',
      deviceName: 'iPhone 16',
      os: 'iOS 18',
      browser: 'Safari',
      ip: '185.94.··.··',
      city: 'Manama',
      country: 'Bahrain',
      at: TS_SIGNIN,
      webBaseUrl: WEB,
    }),

  // 5. CHECK DEPOSIT · APPROVED
  'check-ok': () =>
    buildCheckDepositApprovedEmail({
      firstName: 'Layla',
      referenceId: 'DEP-2026-08812',
      checkNumber: '0044712',
      drawer: 'Al-Salam Trading W.L.L.',
      amount: '1,250.000',
      currency: 'BHD',
      accountMask: '4821',
      accountType: 'Current',
      newBalance: 'BHD 8,914.250',
      depositedAt: TS_DEPOSIT,
      approvedAt: TS_APPROVED,
      webBaseUrl: WEB,
    }),

  // 6. CHECK DEPOSIT · REJECTED
  'check-no': () =>
    buildCheckDepositDeclinedEmail({
      firstName: 'Layla',
      referenceId: 'DEP-2026-08812',
      checkNumber: '0044712',
      amount: '1,250.000',
      currency: 'BHD',
      reason: 'Endorsement missing on the back of the check',
      submittedAt: TS_DEPOSIT,
      reviewedAt: TS_REVIEWED,
      webBaseUrl: WEB,
    }),

  // 7. WIRE TRANSFER · APPROVED
  'wire-ok': () =>
    buildWireApprovedEmail({
      firstName: 'Layla',
      referenceId: 'WIRE-2026-01177',
      beneficiaryName: 'Khalid Al-Mansoori',
      beneficiaryBank: 'Emirates NBD',
      beneficiaryBankLocation: 'Dubai, UAE',
      iban: 'AE07 0331 ···· 4210',
      swiftBic: 'EBILAEAD',
      fromAccountMask: '4821',
      fromAccountType: 'Current',
      amount: '4,500.00',
      currency: 'USD',
      feeFormatted: 'BHD 7.500',
      submittedAt: TS_SUBMITTED,
      approvedAt: TS_WIRE_APPROVED,
      expectedArrival: 'By 4 June 2026',
      webBaseUrl: WEB,
    }),

  // 8. WIRE TRANSFER · REJECTED
  'wire-no': () =>
    buildWireDeclinedEmail({
      firstName: 'Layla',
      referenceId: 'WIRE-2026-01177',
      beneficiaryName: 'Khalid Al-Mansoori',
      beneficiaryBank: 'Emirates NBD',
      beneficiaryBankLocation: 'Dubai, UAE',
      amount: '4,500.00',
      currency: 'USD',
      refundedTo: 'Current ····4821',
      reason: 'Beneficiary IBAN failed validation with receiving bank',
      submittedAt: TS_SUBMITTED,
      webBaseUrl: WEB,
    }),

  // 9. USER-TO-USER · APPROVED
  'p2p-ok': () =>
    buildTransferSentEmail({
      firstName: 'Layla',
      referenceId: 'TXN-9513-2583',
      toName: 'Yousef Al-Hammadi',
      toAccountMask: 'State Bank ····3190',
      fromAccountMask: '4821',
      fromAccountType: 'Current',
      amount: '75.000',
      currency: 'BHD',
      note: 'Dinner last night · thanks!',
      sentAt: TS_SENT,
      newBalance: 'BHD 8,839.250',
      webBaseUrl: WEB,
    }),

  // 10. USER-TO-USER · REJECTED
  'p2p-no': () =>
    buildTransferDeclinedEmail({
      firstName: 'Layla',
      referenceId: 'TXN-9513-2611',
      toName: 'Yousef Al-Hammadi',
      fromAccountMask: '4821',
      fromAccountType: 'Current',
      amount: '1,800.000',
      currency: 'BHD',
      reason: 'Daily transfer limit exceeded (BHD 1,500/day)',
      attemptedAt: TS_ATTEMPTED,
      webBaseUrl: WEB,
    }),

  // 11. ACCOUNT LINKED
  'acct-link': () =>
    buildLinkedApprovedEmail({
      institutionName: 'Ahli United Bank',
      accountType: 'Checking',
      mask: '5621',
      webBaseUrl: WEB,
    }),

  // 12. CARD LINKED
  'card-link': () =>
    buildCardLinkedEmail({
      firstName: 'Layla',
      network: 'Visa',
      cardType: 'Debit',
      issuer: 'Bank ABC',
      cardholderName: 'Layla Al-Sayed',
      cardMask: '4417',
      verifiedVia: '3D Secure',
      linkedAt: TS_LINK,
      webBaseUrl: WEB,
    }),
};

async function main() {
  const [, , cmd, idArg, toArg] = process.argv;

  if (cmd === 'send') {
    await sendMode(idArg ?? 'all', toArg);
    return;
  }

  // Default: render every template to disk.
  const outDir = resolve(__dirname, '..', '..', 'out-emails');
  mkdirSync(outDir, { recursive: true });
  for (const [id, build] of Object.entries(TEMPLATES)) {
    const { subject, html } = build();
    if (!html) {
      console.warn(`${id}: text-only template, skipping HTML dump`);
      continue;
    }
    const file = resolve(outDir, `${id}.html`);
    writeFileSync(file, html, 'utf8');
    console.log(`✓ ${id.padEnd(11)}  ${subject}\n              → ${file}`);
  }
  console.log(`\nDone. Open any file in ${outDir} in a browser.`);
}

async function sendMode(id: string, to?: string) {
  if (!to) {
    console.error('Usage: send <id|all> <to-address>');
    process.exit(1);
  }
  // Lazy-load Nest + the email module so the default "render to disk" path
  // doesn't need any env vars or boot the Nest container.
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../app.module');
  const { EmailService } = await import('../common/email/email.service');

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const email = app.get(EmailService);
    const ids = id === 'all' ? Object.keys(TEMPLATES) : [id];
    for (const i of ids) {
      const build = TEMPLATES[i];
      if (!build) {
        console.error(`Unknown template: ${i}`);
        continue;
      }
      const { subject, text, html } = build();
      await email.sendTransactional({ to, subject, text, html });
      console.log(`✓ sent  ${i.padEnd(11)}  → ${to}  (${subject})`);
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
