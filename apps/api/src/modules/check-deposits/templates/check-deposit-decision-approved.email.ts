/**
 * Customer-facing notification that a mobile check deposit was APPROVED by an
 * admin and the funds were credited. Focused on the data our flow actually
 * captures (no MICR check number / drawer). The amount shown is the value the
 * customer entered on the deposit form, in their display currency.
 * Sent from CheckDepositsService.approve().
 */

import { wrapEmail, emailBlocks } from '../../../common/email/templates/email-chrome';

export interface CheckDepositDecisionApprovedVars {
  firstName: string | null;
  amount: string;
  currency: string;
  accountLabel: string;
  approvedAt: Date;
  webBaseUrl: string;
}

export function buildCheckDepositDecisionApprovedEmail(
  v: CheckDepositDecisionApprovedVars,
) {
  const name = v.firstName ?? 'there';
  const subject = `Check deposit approved — ${v.currency} ${v.amount} credited`;
  const viewUrl = `${v.webBaseUrl}/home/spending`;

  const text = [
    `Hi ${name},`,
    ``,
    `Your check deposit has been approved and the funds have been credited to your account.`,
    ``,
    `Amount credited: ${v.currency} ${v.amount}`,
    `Credited to:     ${v.accountLabel}`,
    `Approved:        ${fmtDateTime(v.approvedAt)}`,
    ``,
    `View activity: ${viewUrl}`,
  ].join('\n');

  const bodyHtml = [
    emailBlocks.successIcon(),
    `<h1 class="body-h1" style="font-family:Georgia,'Times New Roman',serif;font-size:25px;font-weight:700;color:#2B2926;margin:0 0 14px;line-height:1.25;text-align:center;">Check deposit approved</h1>`,
    `<p class="body-text" style="font-family:Georgia,'Times New Roman',serif;font-size:15px;line-height:1.62;color:#514D45;margin:0 0 16px;text-align:center;">Hi ${escape(name)}, your check deposit has been approved and the funds have been credited to your account.</p>`,
    emailBlocks.amountBlock({
      label: 'Amount credited',
      currency: v.currency,
      amount: v.amount,
      statusPill: emailBlocks.statusPill({ kind: 'ok', label: 'Approved' }),
    }),
    emailBlocks.detailTable([
      ['Credited to', v.accountLabel],
      ['Approved', fmtDateTime(v.approvedAt)],
    ]),
    emailBlocks.buttonGold('View activity', viewUrl),
  ].join('');

  const html = wrapEmail({
    title: subject,
    bodyHtml,
    footerLinks: [
      { label: 'Help Centre', href: `${v.webBaseUrl}/profile/help` },
      { label: 'Activity', href: `${v.webBaseUrl}/home/spending` },
      { label: 'Contact', href: `${v.webBaseUrl}/profile/help` },
    ],
  });

  return { subject, text, html };
}

function fmtDateTime(d: Date): string {
  return d.toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' });
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
