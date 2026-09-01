/**
 * Password-reset email that delivers a one-time reset *link* (not a
 * code). Used by the admin "force password reset" action; `adminInitiated`
 * tweaks the copy to explain an administrator started it. Shared State Bank
 * chrome with a gold CTA + lock callout.
 */

import { wrapEmail, emailBlocks } from '../../../../common/email/templates/email-chrome';

export interface PasswordResetLinkVars {
  resetUrl: string;
  ttlMinutes: number;
  /** True when an admin started the reset (vs. the customer's own request). */
  adminInitiated?: boolean;
  /** Optional — enables the footer Help/Contact links. */
  webBaseUrl?: string;
}

export function buildPasswordResetLinkEmail(v: PasswordResetLinkVars) {
  const subject = `Reset your State Bank password`;
  const intro = v.adminInitiated
    ? `An administrator initiated a password reset for your State Bank account. Use the button below to choose a new password.`
    : `We received a request to reset your State Bank password. Use the button below to choose a new one.`;

  const text = [
    intro,
    ``,
    `Reset your password (valid for ${v.ttlMinutes} minutes, single use):`,
    v.resetUrl,
    ``,
    `If you didn't expect this, you can ignore this email, your password won't change until you use the link. If you're concerned, contact support immediately.`,
    ``,
    `State Bank`,
  ].join('\n');

  const bodyHtml = [
    emailBlocks.h1('Reset your password'),
    emailBlocks.para(intro),
    emailBlocks.buttonGold('Reset password', v.resetUrl),
    emailBlocks.para(
      `This link expires in ${emailBlocks.strong(
        `${v.ttlMinutes} minutes`,
      )} and can be used once.`,
    ),
    emailBlocks.secureCallout({
      icon: 'lock',
      text: `If you didn't expect this, you can ignore this email, your password won't change until the link is used. If you're concerned, contact support.`,
    }),
  ].join('');

  const html = wrapEmail({
    title: subject,
    bodyHtml,
    footerLinks: v.webBaseUrl
      ? [
          { label: 'Help Centre', href: `${v.webBaseUrl}/profile/help` },
          { label: 'Security Centre', href: `${v.webBaseUrl}/profile/security` },
        ]
      : undefined,
  });

  return { subject, text, html };
}
