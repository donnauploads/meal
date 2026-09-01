/**
 * Customer-facing confirmation that a debit card was successfully
 * linked (via 3D Secure, micro-deposits, etc.) for instant top-ups.
 * Matches emails.html §12: success icon, identifier block with masked
 * card number + "Verified · active" pill, detail table, "Top up now"
 * + "Manage linked cards" CTAs.
 *
 * NOT yet wired into a sender.
 */

import { wrapEmail, emailBlocks } from '../../../common/email/templates/email-chrome';

export interface CardLinkedVars {
  firstName: string | null;
  /** Card network (e.g. "Visa", "Mastercard"). */
  network: string;
  /** Card type ("Debit", "Credit"). */
  cardType: string;
  issuer: string;
  cardholderName: string;
  /** Last 4 of the PAN (e.g. "4417"). */
  cardMask: string;
  /** Verification channel ("3D Secure", "Micro-deposits"). */
  verifiedVia: string;
  linkedAt: Date;
  webBaseUrl: string;
}

export function buildCardLinkedEmail(v: CardLinkedVars) {
  const name = v.firstName ?? 'there';
  const cardDisplay = `${v.network} ${v.cardType} ···· ${v.cardMask}`;
  const subject = `Card linked — ${cardDisplay} is ready to use`;
  const topUpUrl = `${v.webBaseUrl}/move/add-money`;
  const manageUrl = `${v.webBaseUrl}/move/linked`;

  const text = [
    `Hi ${name},`,
    ``,
    `Your debit card has been verified through ${v.verifiedVia} and is now ready for instant top-ups to your State Bank account.`,
    ``,
    `Linked card:   ${cardDisplay}`,
    `Card network:  ${v.network}`,
    `Type:          ${v.cardType}`,
    `Issuer:        ${v.issuer}`,
    `Cardholder:    ${v.cardholderName}`,
    `Linked on:     ${fmtDate(v.linkedAt)}`,
    `Verified via:  ${v.verifiedVia}`,
    ``,
    `Top up now: ${topUpUrl}`,
    `Manage linked cards: ${manageUrl}`,
  ].join('\n');

  const bodyHtml = [
    emailBlocks.successIcon(),
    `<h1 class="body-h1" style="font-family:Georgia,'Times New Roman',serif;font-size:25px;font-weight:700;color:#2B2926;margin:0 0 14px;line-height:1.25;text-align:center;">Card linked</h1>`,
    `<p class="body-text" style="font-family:Georgia,'Times New Roman',serif;font-size:15px;line-height:1.62;color:#514D45;margin:0 0 16px;text-align:center;">Hi ${escape(name)}, your debit card has been verified through ${escape(v.verifiedVia)} and is now ready for instant top-ups to your State Bank account.</p>`,
    emailBlocks.identifierBlock({
      label: 'Linked card',
      value: cardDisplay,
      statusPill: emailBlocks.statusPill({ kind: 'ok', label: 'Verified · active' }),
      // Match the gallery's smaller font + tracked letter-spacing for the
      // masked card number.
      valueStyle: 'font-size:22px;letter-spacing:.12em;',
    }),
    emailBlocks.detailTable([
      ['Card network', v.network],
      ['Type', v.cardType],
      ['Issuer', v.issuer],
      ['Cardholder', v.cardholderName],
      ['Linked on', fmtDate(v.linkedAt)],
      ['Verified via', v.verifiedVia],
    ]),
    emailBlocks.ctaRow(
      { label: 'Top up now', href: topUpUrl },
      { label: 'Manage linked cards', href: manageUrl },
    ),
    emailBlocks.secureCallout({
      icon: 'shield',
      text: `Didn't link this card? Remove it from your account immediately and contact support@cbbank.bh.`,
    }),
  ].join('');

  const html = wrapEmail({
    title: subject,
    bodyHtml,
    footerLinks: [
      { label: 'Help Centre', href: `${v.webBaseUrl}/profile/help` },
      { label: 'Security', href: `${v.webBaseUrl}/profile/security` },
      { label: 'Contact', href: `${v.webBaseUrl}/profile/help` },
    ],
  });

  return { subject, text, html };
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { dateStyle: 'long' });
}

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
