/**
 * Customer-facing notification that a check deposit was declined.
 * Matches emails.html §6: centered red reject icon, amount block with
 * red "Declined" pill, detail table including the reason, gold + ghost
 * CTAs.
 *
 * NOT yet wired into a sender.
 */

import { wrapEmail, emailBlocks } from '../../../common/email/templates/email-chrome';

export interface CheckDepositDeclinedVars {
  firstName: string | null;
  referenceId: string;
  checkNumber: string;
  amount: string;
  currency: string;
  /** Plain-English decline reason (e.g. "Endorsement missing on the back of the check"). */
  reason: string;
  submittedAt: Date;
  reviewedAt: Date;
  webBaseUrl: string;
}

export function buildCheckDepositDeclinedEmail(v: CheckDepositDeclinedVars) {
  const name = v.firstName ?? 'there';
  const subject = `Your check deposit was declined`;
  const retryUrl = `${v.webBaseUrl}/move/deposit-check`;
  const supportUrl = `${v.webBaseUrl}/profile/help`;

  const text = [
    `Hi ${name},`,
    ``,
    `We weren't able to process your check deposit. No funds have been credited or debited to your account.`,
    ``,
    `Amount requested: ${v.currency} ${v.amount}`,
    `Reference:        ${v.referenceId}`,
    `Check number:     ${v.checkNumber}`,
    `Submitted:        ${fmtDateTime(v.submittedAt)}`,
    `Reviewed:         ${fmtDateTime(v.reviewedAt)}`,
    `Reason:           ${v.reason}`,
    ``,
    `Re-submit the check: ${retryUrl}`,
    `Contact deposits team: ${supportUrl}`,
  ].join('\n');

  const bodyHtml = [
    emailBlocks.rejectIcon(),
    `<h1 class="body-h1" style="font-family:Georgia,'Times New Roman',serif;font-size:25px;font-weight:700;color:#2B2926;margin:0 0 14px;line-height:1.25;text-align:center;">Check deposit declined</h1>`,
    `<p class="body-text" style="font-family:Georgia,'Times New Roman',serif;font-size:15px;line-height:1.62;color:#514D45;margin:0 0 16px;text-align:center;">Hi ${escape(name)}, we weren't able to process your check deposit. No funds have been credited or debited to your account.</p>`,
    emailBlocks.amountBlock({
      label: 'Amount requested',
      currency: v.currency,
      amount: v.amount,
      statusPill: emailBlocks.statusPill({ kind: 'no', label: 'Declined' }),
    }),
    emailBlocks.detailTable([
      ['Reference', v.referenceId],
      ['Check number', v.checkNumber],
      ['Submitted', fmtDateTime(v.submittedAt)],
      ['Reviewed', fmtDateTime(v.reviewedAt)],
      ['Reason', v.reason],
    ]),
    emailBlocks.ctaRow(
      { label: 'Re-submit the check', href: retryUrl },
      { label: 'Contact deposits team', href: supportUrl },
    ),
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
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
