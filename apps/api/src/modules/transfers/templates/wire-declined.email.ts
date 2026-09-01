/**
 * Customer-facing notification that a wire transfer was declined and
 * the full amount has been refunded. Matches emails.html §8: red reject
 * icon, amount block with "Declined · refunded" pill, detail table
 * including reason, gold + ghost CTAs.
 *
 * NOT yet wired into a sender.
 */

import { wrapEmail, emailBlocks } from '../../../common/email/templates/email-chrome';

export interface WireDeclinedVars {
  firstName: string | null;
  referenceId: string;
  beneficiaryName: string;
  beneficiaryBank: string;
  beneficiaryBankLocation?: string;
  amount: string;
  currency: string;
  /** Where the refund landed (e.g. "Current ····4821"). */
  refundedTo: string;
  reason: string;
  submittedAt: Date;
  webBaseUrl: string;
}

export function buildWireDeclinedEmail(v: WireDeclinedVars) {
  const name = v.firstName ?? 'there';
  const subject = `Your wire transfer was declined — funds refunded`;
  const retryUrl = `${v.webBaseUrl}/move/wire`;
  const complianceUrl = `${v.webBaseUrl}/profile/help`;
  const bankLine = v.beneficiaryBankLocation
    ? `${v.beneficiaryBank} · ${v.beneficiaryBankLocation}`
    : v.beneficiaryBank;

  const text = [
    `Hi ${name},`,
    ``,
    `We weren't able to process your wire transfer. The full amount has been refunded to your source account.`,
    ``,
    `Amount returned:  ${v.currency} ${v.amount}`,
    `Reference:        ${v.referenceId}`,
    `Beneficiary:      ${v.beneficiaryName}`,
    `Beneficiary bank: ${bankLine}`,
    `Submitted:        ${fmtDateTime(v.submittedAt)}`,
    `Refunded to:      ${v.refundedTo}`,
    `Reason:           ${v.reason}`,
  ].join('\n');

  const bodyHtml = [
    emailBlocks.rejectIcon(),
    `<h1 class="body-h1" style="font-family:Georgia,'Times New Roman',serif;font-size:25px;font-weight:700;color:#2B2926;margin:0 0 14px;line-height:1.25;text-align:center;">Wire transfer declined</h1>`,
    `<p class="body-text" style="font-family:Georgia,'Times New Roman',serif;font-size:15px;line-height:1.62;color:#514D45;margin:0 0 16px;text-align:center;">Hi ${escape(name)}, we weren't able to process your wire transfer. The full amount has been refunded to your source account.</p>`,
    emailBlocks.amountBlock({
      label: 'Amount returned',
      currency: v.currency,
      amount: v.amount,
      statusPill: emailBlocks.statusPill({ kind: 'no', label: 'Declined · refunded' }),
    }),
    emailBlocks.detailTable([
      ['Reference', v.referenceId],
      ['Beneficiary', v.beneficiaryName],
      ['Beneficiary bank', bankLine],
      ['Submitted', fmtDateTime(v.submittedAt)],
      ['Refunded to', v.refundedTo],
      ['Reason', v.reason],
    ]),
    emailBlocks.ctaRow(
      { label: 'Try the wire again', href: retryUrl },
      { label: 'Speak to compliance', href: complianceUrl },
    ),
  ].join('');

  const html = wrapEmail({
    title: subject,
    bodyHtml,
    footerLinks: [
      { label: 'Help Centre', href: `${v.webBaseUrl}/profile/help` },
      { label: 'Compliance', href: `${v.webBaseUrl}/profile/help` },
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
