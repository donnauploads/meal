/**
 * Customer-facing notification that a P2P transfer was declined (limit,
 * risk rule, etc.). Matches emails.html §10: red reject icon, amount
 * block with "Declined" pill, reason in detail table, "Request limit
 * increase" + "Try a smaller amount" CTAs.
 *
 * NOT yet wired into a sender.
 */

import { wrapEmail, emailBlocks } from '../../../common/email/templates/email-chrome';

export interface TransferDeclinedVars {
  firstName: string | null;
  referenceId: string;
  toName: string;
  fromAccountMask: string;
  fromAccountType?: string;
  amount: string;
  currency: string;
  /** Plain-English decline reason (e.g. "Daily transfer limit exceeded (BHD 1,500/day)"). */
  reason: string;
  attemptedAt: Date;
  webBaseUrl: string;
}

export function buildTransferDeclinedEmail(v: TransferDeclinedVars) {
  const name = v.firstName ?? 'there';
  const subject = `Your transfer was declined`;
  const limitsUrl = `${v.webBaseUrl}/profile/security`;
  const retryUrl = `${v.webBaseUrl}/pay`;
  const fromLabel = `${v.fromAccountType ?? 'Current'} ····${v.fromAccountMask}`;

  const text = [
    `Hi ${name},`,
    ``,
    `We weren't able to send your transfer. No funds have been moved from your account.`,
    ``,
    `Amount attempted: ${v.currency} ${v.amount}`,
    `Reference:        ${v.referenceId}`,
    `To:               ${v.toName}`,
    `From:             ${fromLabel}`,
    `Attempted:        ${fmtDateTime(v.attemptedAt)}`,
    `Reason:           ${v.reason}`,
  ].join('\n');

  const bodyHtml = [
    emailBlocks.rejectIcon(),
    `<h1 class="body-h1" style="font-family:Georgia,'Times New Roman',serif;font-size:25px;font-weight:700;color:#2B2926;margin:0 0 14px;line-height:1.25;text-align:center;">Transfer declined</h1>`,
    `<p class="body-text" style="font-family:Georgia,'Times New Roman',serif;font-size:15px;line-height:1.62;color:#514D45;margin:0 0 16px;text-align:center;">Hi ${escape(name)}, we weren't able to send your transfer. No funds have been moved from your account.</p>`,
    emailBlocks.amountBlock({
      label: 'Amount attempted',
      currency: v.currency,
      amount: v.amount,
      statusPill: emailBlocks.statusPill({ kind: 'no', label: 'Declined' }),
    }),
    emailBlocks.detailTable([
      ['Reference', v.referenceId],
      ['To', v.toName],
      ['From', fromLabel],
      ['Attempted', fmtDateTime(v.attemptedAt)],
      ['Reason', v.reason],
    ]),
    emailBlocks.ctaRow(
      { label: 'Request limit increase', href: limitsUrl },
      { label: 'Try a smaller amount', href: retryUrl },
    ),
  ].join('');

  const html = wrapEmail({
    title: subject,
    bodyHtml,
    footerLinks: [
      { label: 'Help Centre', href: `${v.webBaseUrl}/profile/help` },
      { label: 'Limits', href: `${v.webBaseUrl}/profile/security` },
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
