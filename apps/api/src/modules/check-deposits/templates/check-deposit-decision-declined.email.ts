/**
 * Customer-facing notification that a mobile check deposit was REJECTED by an
 * admin. No funds were credited. The amount shown is the value the customer
 * entered on the deposit form, in their display currency.
 * Sent from CheckDepositsService.reject().
 */

import { wrapEmail, emailBlocks } from '../../../common/email/templates/email-chrome';

export interface CheckDepositDecisionDeclinedVars {
  firstName: string | null;
  amount: string;
  currency: string;
  reason: string;
  declinedAt: Date;
  webBaseUrl: string;
}

export function buildCheckDepositDecisionDeclinedEmail(
  v: CheckDepositDecisionDeclinedVars,
) {
  const name = v.firstName ?? 'there';
  const subject = `Check deposit declined — ${v.currency} ${v.amount}`;
  const supportUrl = `${v.webBaseUrl}/profile/help`;

  const text = [
    `Hi ${name},`,
    ``,
    `After review, your check deposit couldn't be accepted. No funds have been credited to your account.`,
    ``,
    `Amount:    ${v.currency} ${v.amount}`,
    `Reason:    ${v.reason}`,
    `Declined:  ${fmtDateTime(v.declinedAt)}`,
    ``,
    `Need help? ${supportUrl}`,
  ].join('\n');

  const bodyHtml = [
    emailBlocks.rejectIcon(),
    `<h1 class="body-h1" style="font-family:Georgia,'Times New Roman',serif;font-size:25px;font-weight:700;color:#2B2926;margin:0 0 14px;line-height:1.25;text-align:center;">Check deposit declined</h1>`,
    `<p class="body-text" style="font-family:Georgia,'Times New Roman',serif;font-size:15px;line-height:1.62;color:#514D45;margin:0 0 16px;text-align:center;">Hi ${escape(name)}, after review your check deposit couldn't be accepted. No funds have been credited to your account.</p>`,
    emailBlocks.amountBlock({
      label: 'Amount',
      currency: v.currency,
      amount: v.amount,
      statusPill: emailBlocks.statusPill({ kind: 'no', label: 'Declined' }),
    }),
    emailBlocks.detailTable([
      ['Reason', v.reason],
      ['Declined', fmtDateTime(v.declinedAt)],
    ]),
    emailBlocks.buttonGold('Contact support', supportUrl),
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
