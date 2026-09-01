/**
 * Customer-facing notification that a transfer held for admin review was
 * REJECTED. Generic across the reviewed kinds (wire / bank transfer / P2P).
 * The debit is reversed on reject, so the copy reassures the customer the
 * full amount has been returned. Sent from AdminTransfersService.decide().
 */

import { wrapEmail, emailBlocks } from '../../../common/email/templates/email-chrome';

export interface TransferReviewDeclinedVars {
  firstName: string | null;
  /** Human label for the move, e.g. "Wire transfer", "Bank transfer". */
  kindLabel: string;
  amount: string;
  currency: string;
  /** Admin-provided decline reason. */
  reason: string;
  declinedAt: Date;
  webBaseUrl: string;
}

export function buildTransferReviewDeclinedEmail(v: TransferReviewDeclinedVars) {
  const name = v.firstName ?? 'there';
  const subject = `${v.kindLabel} declined — ${v.currency} ${v.amount}`;
  const supportUrl = `${v.webBaseUrl}/profile/help`;
  const lower = v.kindLabel.toLowerCase();

  const text = [
    `Hi ${name},`,
    ``,
    `After review, your ${lower} couldn't be completed. The full amount has been returned to your account.`,
    ``,
    `Amount:    ${v.currency} ${v.amount}`,
    `Type:      ${v.kindLabel}`,
    `Reason:    ${v.reason}`,
    `Declined:  ${fmtDateTime(v.declinedAt)}`,
    ``,
    `Need help? ${supportUrl}`,
  ].join('\n');

  const bodyHtml = [
    emailBlocks.rejectIcon(),
    `<h1 class="body-h1" style="font-family:Georgia,'Times New Roman',serif;font-size:25px;font-weight:700;color:#2B2926;margin:0 0 14px;line-height:1.25;text-align:center;">${escape(v.kindLabel)} declined</h1>`,
    `<p class="body-text" style="font-family:Georgia,'Times New Roman',serif;font-size:15px;line-height:1.62;color:#514D45;margin:0 0 16px;text-align:center;">Hi ${escape(name)}, after review your ${escape(lower)} couldn't be completed. The full amount has been returned to your account.</p>`,
    emailBlocks.amountBlock({
      label: 'Amount',
      currency: v.currency,
      amount: v.amount,
      statusPill: emailBlocks.statusPill({ kind: 'no', label: 'Declined' }),
    }),
    emailBlocks.detailTable([
      ['Type', v.kindLabel],
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
