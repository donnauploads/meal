/**
 * Customer-facing confirmation that an external-bank link request was
 * approved by an admin. Success badge + detail table + gold CTA, matching
 * the design's "Registration successful" treatment (emails.html §3).
 */

import { wrapEmail, emailBlocks } from '../../../common/email/templates/email-chrome';

export interface LinkedApprovedVars {
  institutionName: string;
  webBaseUrl: string;
  /** Optional account metadata for the detail table. */
  accountType?: string | null;
  mask?: string | null;
}

export function buildLinkedApprovedEmail(v: LinkedApprovedVars) {
  const subject = `${v.institutionName} is now linked to your account`;
  const transferUrl = `${v.webBaseUrl}/move/transfer`;

  const accountLine =
    v.accountType || v.mask
      ? `${cap(v.accountType ?? 'Account')}${v.mask ? ` •••• ${v.mask}` : ''}`
      : null;

  const text = [
    `Good news, your ${v.institutionName} link has been approved.`,
    ``,
    `You can now transfer money to and from this account inside online banking.`,
    ``,
    `Make a transfer: ${transferUrl}`,
    ``,
    `State Bank`,
  ].join('\n');

  const rows: Array<[string, string]> = [['Institution', v.institutionName]];
  if (accountLine) rows.push(['Account', accountLine]);
  rows.push(['Status', 'Linked']);

  // Detail rows for the gallery §11 layout — drop the redundant
  // "Institution" / "Status" rows here because the identifierBlock above
  // already shows both. Keep the type + masked account # + holder.
  const detailRows: Array<[string, string]> = [];
  if (v.accountType) detailRows.push(['Account type', cap(v.accountType)]);
  if (v.mask) detailRows.push(['Account number', `···· ···· ···· ${v.mask}`]);
  detailRows.push(['Linked on', new Date().toLocaleDateString('en-GB', { dateStyle: 'long' })]);
  detailRows.push(['Verified via', 'Micro-deposits']);

  const bodyHtml = [
    emailBlocks.successIcon(),
    `<h1 class="body-h1" style="font-family:Georgia,'Times New Roman',serif;font-size:25px;font-weight:700;color:#2B2926;margin:0 0 14px;line-height:1.25;text-align:center;">Account linked</h1>`,
    `<p class="body-text" style="font-family:Georgia,'Times New Roman',serif;font-size:15px;line-height:1.62;color:#514D45;margin:0 0 16px;text-align:center;">Your external bank account has been verified and linked. You can now move money between your State Bank account and this institution.</p>`,
    emailBlocks.identifierBlock({
      label: 'Linked institution',
      value: v.institutionName,
      statusPill: emailBlocks.statusPill({ kind: 'ok', label: 'Verified · active' }),
    }),
    emailBlocks.detailTable(detailRows),
    emailBlocks.ctaRow(
      { label: 'Move money', href: transferUrl },
      { label: 'Manage linked accounts', href: `${v.webBaseUrl}/move/linked` },
    ),
    emailBlocks.secureCallout({
      icon: 'shield',
      text: `Didn't link this account? Disconnect it immediately and contact support@cbbank.bh.`,
    }),
  ].join('');

  const html = wrapEmail({
    title: subject,
    bodyHtml,
    footerLinks: [
      { label: 'Help Centre', href: `${v.webBaseUrl}/profile/help` },
      { label: 'Contact us', href: `${v.webBaseUrl}/profile/help` },
    ],
  });

  return { subject, text, html };
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
