/**
 * Admin Cc copy of a sign-in / sign-up verification code. Sent to the
 * configured ADMIN_NOTIFICATION_EMAIL inbox so support can pair with
 * the user during demos.
 *
 * Visually mirrors the customer-facing verification-code email (same
 * chrome, same code-box) but adds an admin-only detail strip with the
 * user, IP, and device — and a red ribbon up top so it's obviously not
 * forwardable to the customer.
 */

import {
  wrapEmail,
  emailBlocks,
} from '../../../common/email/templates/email-chrome';

export type AdminCodeCopyKind = 'Sign-in' | 'Sign-up';

export interface AdminCodeCopyVars {
  kind: AdminCodeCopyKind;
  userEmail: string;
  code: string;
  minutes: number;
  ip?: string;
  device?: string;
}

export function buildAdminCodeCopyEmail(v: AdminCodeCopyVars) {
  const subject = `[Admin copy] ${v.kind} code for ${v.userEmail}: ${v.code}`;

  const text = [
    `${v.kind} verification code issued.`,
    ``,
    `User:   ${v.userEmail}`,
    `Code:   ${v.code}`,
    `Expires in ${v.minutes} minutes`,
    v.ip ? `IP:     ${v.ip}` : null,
    v.device ? `Device: ${v.device}` : null,
    ``,
    `This is an admin copy. The user also received the code at their own inbox.`,
  ]
    .filter(Boolean)
    .join('\n');

  // Red "admin only" ribbon — explicit so it can't be mistaken for the
  // customer-facing template.
  const ribbon = `<div style="background:#B5121B;color:#fff;font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;text-align:center;padding:8px 10px;margin:0 0 16px;border-radius:2px;">
    Admin Copy · Do Not Forward
  </div>`;

  const detailRows: Array<[string, string]> = [
    ['Customer', v.userEmail],
    ['Channel', v.kind],
    ['Expires in', `${v.minutes} minute${v.minutes === 1 ? '' : 's'}`],
  ];
  if (v.ip) detailRows.push(['IP address', v.ip]);
  if (v.device) detailRows.push(['Device', v.device]);

  const bodyHtml = [
    ribbon,
    emailBlocks.h1(`${v.kind} code issued`),
    emailBlocks.para(
      `A ${v.kind.toLowerCase()} verification code was just issued for the customer below. The same code was emailed to the customer's inbox, this Cc lands here so support can pair with them if they ask.`,
    ),
    emailBlocks.codeBox({
      label: 'Code',
      code: spaceCode(v.code),
      expiryNote: `Expires in ${v.minutes} minute${v.minutes === 1 ? '' : 's'}`,
    }),
    emailBlocks.detailTable(detailRows),
    emailBlocks.secureCallout({
      icon: 'shield',
      text: `Do not forward this email or relay the code to the customer. Have them check their own inbox.`,
    }),
  ].join('');

  const html = wrapEmail({
    title: subject,
    bodyHtml,
    footerTail: `This is an internal admin notification. Verification codes are short-lived (${v.minutes} min) and single-use.`,
  });

  return { subject, text, html };
}

function spaceCode(code: string): string {
  if (/^\d{6}$/.test(code)) return `${code.slice(0, 3)} ${code.slice(3)}`;
  return code;
}
