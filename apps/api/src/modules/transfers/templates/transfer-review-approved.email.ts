/**
 * Customer-facing notification that a transfer held for admin review was
 * APPROVED. Generic across the reviewed kinds (wire / bank transfer / P2P) so
 * a single template covers every outbound money-move the review queue handles.
 * Sent from AdminTransfersService.decide() on the approve path.
 */

import { wrapEmail, emailBlocks } from '../../../common/email/templates/email-chrome';

export interface TransferReviewApprovedVars {
  firstName: string | null;
  /** Human label for the move, e.g. "Wire transfer", "Bank transfer". */
  kindLabel: string;
  amount: string;
  currency: string;
  approvedAt: Date;
  webBaseUrl: string;
}

export function buildTransferReviewApprovedEmail(v: TransferReviewApprovedVars) {
  const name = v.firstName ?? 'there';
  const subject = `${v.kindLabel} approved — ${v.currency} ${v.amount}`;
  const viewUrl = `${v.webBaseUrl}/home/spending`;
  const lower = v.kindLabel.toLowerCase();

  const text = [
    `Hi ${name},`,
    ``,
    `Good news — your ${lower} has been reviewed and approved. The funds are on their way.`,
    ``,
    `Amount:    ${v.currency} ${v.amount}`,
    `Type:      ${v.kindLabel}`,
    `Approved:  ${fmtDateTime(v.approvedAt)}`,
    ``,
    `View transaction: ${viewUrl}`,
  ].join('\n');

  const bodyHtml = [
    emailBlocks.successIcon(),
    `<h1 class="body-h1" style="font-family:Georgia,'Times New Roman',serif;font-size:25px;font-weight:700;color:#2B2926;margin:0 0 14px;line-height:1.25;text-align:center;">${escape(v.kindLabel)} approved</h1>`,
    `<p class="body-text" style="font-family:Georgia,'Times New Roman',serif;font-size:15px;line-height:1.62;color:#514D45;margin:0 0 16px;text-align:center;">Hi ${escape(name)}, your ${escape(lower)} has been reviewed and approved. The funds are on their way.</p>`,
    emailBlocks.amountBlock({
      label: 'Amount',
      currency: v.currency,
      amount: v.amount,
      statusPill: emailBlocks.statusPill({ kind: 'ok', label: 'Approved' }),
    }),
    emailBlocks.detailTable([
      ['Type', v.kindLabel],
      ['Approved', fmtDateTime(v.approvedAt)],
    ]),
    emailBlocks.buttonGold('View transaction', viewUrl),
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
