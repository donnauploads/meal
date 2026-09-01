/**
 * Customer-facing confirmation that an international wire transfer was
 * released to the receiving bank. Matches emails.html §7 ("Wire transfer
 * approved"): green success icon, amount block with "Approved · in
 * transit" pill, full beneficiary detail table, "View wire receipt" CTA.
 *
 * NOT yet wired into a sender.
 */

import { wrapEmail, emailBlocks } from '../../../common/email/templates/email-chrome';

export interface WireApprovedVars {
  firstName: string | null;
  referenceId: string;
  beneficiaryName: string;
  beneficiaryBank: string;
  beneficiaryBankLocation?: string;
  iban: string;
  swiftBic: string;
  /** Source account masked tail (e.g. "4821"). */
  fromAccountMask: string;
  fromAccountType?: string;
  amount: string;
  currency: string;
  feeFormatted: string;
  submittedAt: Date;
  approvedAt: Date;
  expectedArrival: string;
  webBaseUrl: string;
}

export function buildWireApprovedEmail(v: WireApprovedVars) {
  const name = v.firstName ?? 'there';
  const subject = `Wire transfer approved — ${v.currency} ${v.amount} sent`;
  const receiptUrl = `${v.webBaseUrl}/move/wire`;
  const fromLabel = `${v.fromAccountType ?? 'Current'} ····${v.fromAccountMask}`;
  const bankLine = v.beneficiaryBankLocation
    ? `${v.beneficiaryBank} · ${v.beneficiaryBankLocation}`
    : v.beneficiaryBank;

  const text = [
    `Hi ${name},`,
    ``,
    `Your wire transfer has been approved and released to the receiving bank.`,
    ``,
    `Amount sent:        ${v.currency} ${v.amount}`,
    `Reference:          ${v.referenceId}`,
    `Beneficiary:        ${v.beneficiaryName}`,
    `Beneficiary bank:   ${bankLine}`,
    `IBAN:               ${v.iban}`,
    `SWIFT/BIC:          ${v.swiftBic}`,
    `From:               ${fromLabel}`,
    `Fee:                ${v.feeFormatted}`,
    `Submitted:          ${fmtDateTime(v.submittedAt)}`,
    `Approved:           ${fmtDateTime(v.approvedAt)}`,
    `Expected to arrive: ${v.expectedArrival}`,
    ``,
    `View wire receipt: ${receiptUrl}`,
  ].join('\n');

  const bodyHtml = [
    emailBlocks.successIcon(),
    `<h1 class="body-h1" style="font-family:Georgia,'Times New Roman',serif;font-size:25px;font-weight:700;color:#2B2926;margin:0 0 14px;line-height:1.25;text-align:center;">Wire transfer approved</h1>`,
    `<p class="body-text" style="font-family:Georgia,'Times New Roman',serif;font-size:15px;line-height:1.62;color:#514D45;margin:0 0 16px;text-align:center;">Hi ${escape(name)}, your wire transfer has been approved and released to the receiving bank.</p>`,
    emailBlocks.amountBlock({
      label: 'Amount sent',
      currency: v.currency,
      amount: v.amount,
      statusPill: emailBlocks.statusPill({ kind: 'ok', label: 'Approved · in transit' }),
    }),
    emailBlocks.detailTable([
      ['Reference', v.referenceId],
      ['Beneficiary', v.beneficiaryName],
      ['Beneficiary bank', bankLine],
      ['IBAN', v.iban],
      ['SWIFT/BIC', v.swiftBic],
      ['From', fromLabel],
      ['Fee', v.feeFormatted],
      ['Submitted', fmtDateTime(v.submittedAt)],
      ['Approved', fmtDateTime(v.approvedAt)],
      ['Expected to arrive', v.expectedArrival],
    ]),
    emailBlocks.buttonGold('View wire receipt', receiptUrl),
  ].join('');

  const html = wrapEmail({
    title: subject,
    bodyHtml,
    footerLinks: [
      { label: 'Help Centre', href: `${v.webBaseUrl}/profile/help` },
      { label: 'Track wire', href: `${v.webBaseUrl}/move/wire` },
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
