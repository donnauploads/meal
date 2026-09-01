/**
 * Customer-facing confirmation of an instant P2P transfer between two
 * State Bank customers. Matches emails.html §9: green success icon, amount
 * block with "Completed" pill, detail table including recipient name +
 * note, "View transaction" CTA.
 *
 * NOT yet wired into a sender — the transfers service currently emits
 * a transaction record + WS push, no email goes to the user.
 */

import { wrapEmail, emailBlocks } from '../../../common/email/templates/email-chrome';

export interface TransferSentVars {
  firstName: string | null;
  referenceId: string;
  toName: string;
  /** Recipient account label (e.g. "State Bank ····3190"). */
  toAccountMask: string;
  fromAccountMask: string;
  fromAccountType?: string;
  amount: string;
  currency: string;
  /** Optional memo / note from the sender. Hidden when empty. */
  note?: string | null;
  sentAt: Date;
  newBalance: string;
  webBaseUrl: string;
}

export function buildTransferSentEmail(v: TransferSentVars) {
  const name = v.firstName ?? 'there';
  const subject = `Transfer sent — ${v.currency} ${v.amount} to ${v.toName}`;
  const viewUrl = `${v.webBaseUrl}/home/spending`;
  const fromLabel = `${v.fromAccountType ?? 'Current'} ····${v.fromAccountMask}`;

  const rows: Array<[string, string]> = [
    ['Reference', v.referenceId],
    ['To', v.toName],
    ['Recipient account', v.toAccountMask],
    ['From', fromLabel],
  ];
  if (v.note) rows.push(['Note', v.note]);
  rows.push(['Sent', fmtDateTime(v.sentAt)]);
  rows.push(['New available balance', v.newBalance]);

  const text = [
    `Hi ${name},`,
    ``,
    `Your transfer has been sent. The recipient has been notified and the funds are available to them now.`,
    ``,
    `Amount sent:           ${v.currency} ${v.amount}`,
    `Reference:             ${v.referenceId}`,
    `To:                    ${v.toName}`,
    `Recipient account:     ${v.toAccountMask}`,
    `From:                  ${fromLabel}`,
    v.note ? `Note:                  ${v.note}` : '',
    `Sent:                  ${fmtDateTime(v.sentAt)}`,
    `New available balance: ${v.newBalance}`,
    ``,
    `View transaction: ${viewUrl}`,
  ]
    .filter(Boolean)
    .join('\n');

  const bodyHtml = [
    emailBlocks.successIcon(),
    `<h1 class="body-h1" style="font-family:Georgia,'Times New Roman',serif;font-size:25px;font-weight:700;color:#2B2926;margin:0 0 14px;line-height:1.25;text-align:center;">Transfer sent</h1>`,
    `<p class="body-text" style="font-family:Georgia,'Times New Roman',serif;font-size:15px;line-height:1.62;color:#514D45;margin:0 0 16px;text-align:center;">Hi ${escape(name)}, your transfer has been sent. The recipient has been notified and the funds are available to them now.</p>`,
    emailBlocks.amountBlock({
      label: 'Amount sent',
      currency: v.currency,
      amount: v.amount,
      statusPill: emailBlocks.statusPill({ kind: 'ok', label: 'Completed' }),
    }),
    emailBlocks.detailTable(rows),
    emailBlocks.buttonGold('View transaction', viewUrl),
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
