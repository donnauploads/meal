/**
 * Sent on `session.created` to the account owner — "your account was
 * just accessed". Mirrors the design's "New sign-in notification" email
 * (emails.html section 4): detail table of device + IP + location +
 * timestamp, ghost "This wasn't me" CTA, security callout.
 */

import { wrapEmail, emailBlocks } from '../../../../common/email/templates/email-chrome';

export interface SigninAlertVars {
  deviceName: string;
  os: string;
  browser: string;
  ip: string;
  city?: string;
  region?: string;
  country?: string;
  at: Date;
  webBaseUrl: string;
  /** Owner's first name, if we know it. Falls back to the generic
   *  "Hello,". */
  firstName?: string | null;
}

export function buildSigninAlertEmail(v: SigninAlertVars) {
  const loc =
    [v.city, v.region, v.country].filter(Boolean).join(', ') ||
    'unknown location';
  const securityUrl = `${v.webBaseUrl}/profile/security`;
  const subject = `New sign-in to your account`;
  const greeting = v.firstName ? `Hello ${v.firstName}` : `Hello`;

  const text = [
    `${greeting},`,
    ``,
    `Your State Bank online banking was just accessed.`,
    ``,
    `Date & time: ${v.at.toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' })}`,
    `Device:      ${v.deviceName} · ${v.browser}`,
    `OS:          ${v.os}`,
    `Location:    ${loc}`,
    `IP address:  ${v.ip}`,
    ``,
    `If this was you, no action is needed.`,
    `If not, secure your account immediately: ${securityUrl}`,
  ].join('\n');

  const deviceCell = `${v.deviceName} · ${v.browser}`;
  const bodyHtml = [
    emailBlocks.h1('New sign-in to your account'),
    emailBlocks.para(
      `${greeting}, your State Bank online banking was just accessed. If this was you, no action is needed.`,
    ),
    emailBlocks.detailTable([
      [
        'Date & time',
        v.at.toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' }),
      ],
      ['Device', deviceCell],
      ['Location', loc],
      ['IP address', v.ip],
    ]),
    emailBlocks.para(
      `${emailBlocks.strong("Don't recognise this activity?")} Secure your account now, change your password and review your trusted devices.`,
    ),
    emailBlocks.buttonGhost(`This wasn't me, secure my account`, securityUrl),
    emailBlocks.secureCallout({
      icon: 'shield',
      text: `We send this alert whenever your account is accessed from a new device, to help keep your money safe.`,
    }),
  ].join('');

  const html = wrapEmail({
    title: subject,
    bodyHtml,
    footerLinks: [
      { label: 'Security Centre', href: securityUrl },
      { label: 'Contact us', href: `${v.webBaseUrl}/profile/help` },
    ],
    footerTail: `This is an automated security notification. Please do not reply.`,
  });

  return { subject, text, html };
}
