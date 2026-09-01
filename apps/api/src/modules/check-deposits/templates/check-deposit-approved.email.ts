/**
 * Customer-facing confirmation that a check deposit was approved by an
 * admin and the funds have been credited. Matches emails.html §5
 * ("Check deposit approved"): centered green success icon, amount block
 * with green "Approved" pill, full detail table, gold "View deposit
 * receipt" CTA.
 *
 * NOT yet wired into a sender — the existing check-deposits.service.ts
 * only emails admins on submission. Wire this into the admin approval
 * flow when ready.
 */

import { wrapEmail, emailBlocks } from '../../../common/email/templates/email-chrome';

export interface CheckDepositApprovedVars {
  firstName: string | null;
  /** Public reference shown to the customer (e.g. "DEP-2026-08812"). */
  referenceId: string;
  /** Check number from the MICR line. */
  checkNumber: string;
  /** Drawer / payer name printed on the check. */
  drawer: string;
  /** Formatted amount excluding currency ("1,250.000"). */
  amount: string;
  /** ISO 4217 code — typically "BHD" or "USD". */
  currency: string;
  /** Last 4 of the destination account, e.g. "4821". */
  accountMask: string;
  /** Account type label ("Current", "Savings"). */
  accountType?: string;
  /** Formatted new available balance with currency ("BHD 8,914.250"). */
  newBalance: string;
  depositedAt: Date;
  approvedAt: Date;
  webBaseUrl: string;
}

export function buildCheckDepositApprovedEmail(v: CheckDepositApprovedVars) {
  const name = v.firstName ?? 'there';
  const subject = `Check deposit approved — ${v.currency} ${v.amount} credited`;
  const receiptUrl = `${v.webBaseUrl}/profile/documents`;
  const acctLabel = `${v.accountType ?? 'Current'} ····${v.accountMask}`;

  const text = [
    `Hi ${name},`,
    ``,
    `Your check has been approved and the funds have been credited to your account.`,
    ``,
    `Amount credited:       ${v.currency} ${v.amount}`,
    `Reference:             ${v.referenceId}`,
    `Check number:          ${v.checkNumber}`,
    `Drawer:                ${v.drawer}`,
    `Deposited:             ${fmtDateTime(v.depositedAt)}`,
    `Approved:              ${fmtDateTime(v.approvedAt)}`,
    `Deposited to:          ${acctLabel}`,
    `New available balance: ${v.newBalance}`,
    ``,
    `View deposit receipt: ${receiptUrl}`,
  ].join('\n');

  const bodyHtml = [
    emailBlocks.successIcon(),
    `<h1 class="body-h1" style="font-family:Georgia,'Times New Roman',serif;font-size:25px;font-weight:700;color:#2B2926;margin:0 0 14px;line-height:1.25;text-align:center;">Check deposit approved</h1>`,
    `<p class="body-text" style="font-family:Georgia,'Times New Roman',serif;font-size:15px;line-height:1.62;color:#514D45;margin:0 0 16px;text-align:center;">Hi ${escape(name)}, your check has been approved and the funds have been credited to your account.</p>`,
    emailBlocks.amountBlock({
      label: 'Amount credited',
      currency: v.currency,
      amount: v.amount,
      statusPill: emailBlocks.statusPill({ kind: 'ok', label: 'Approved' }),
    }),
    emailBlocks.detailTable([
      ['Reference', v.referenceId],
      ['Check number', v.checkNumber],
      ['Drawer', v.drawer],
      ['Deposited', fmtDateTime(v.depositedAt)],
      ['Approved', fmtDateTime(v.approvedAt)],
      ['Deposited to', acctLabel],
      ['New available balance', v.newBalance],
    ]),
    emailBlocks.buttonGold('View deposit receipt', receiptUrl),
  ].join('');

  const html = wrapEmail({
    title: subject,
    bodyHtml,
    footerLinks: [
      { label: 'Help Centre', href: `${v.webBaseUrl}/profile/help` },
      { label: 'Dispute', href: `${v.webBaseUrl}/profile/help` },
      { label: 'Contact', href: `${v.webBaseUrl}/profile/help` },
    ],
  });

  return { subject, text, html };
}

function fmtDateTime(d: Date): string {
  return d.toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' });
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
