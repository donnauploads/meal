/**
 * Customer-facing notice that an external-bank link request could not be
 * approved, with the admin's reason. Shared State Bank chrome; surfaces the
 * reason in a callout and offers a "Try again" CTA.
 */

import { wrapEmail, emailBlocks } from '../../../common/email/templates/email-chrome';

export interface LinkedRejectedVars {
  institutionName: string;
  reason: string;
  webBaseUrl: string;
}

export function buildLinkedRejectedEmail(v: LinkedRejectedVars) {
  const subject = `Your ${v.institutionName} link couldn't be approved`;
  const reason = v.reason.trim();
  const linkedUrl = `${v.webBaseUrl}/move/linked`;

  const text = [
    `We weren't able to approve your request to link ${v.institutionName}.`,
    ``,
    `Reason: ${reason}`,
    ``,
    `You can review your linked accounts or try again here: ${linkedUrl}`,
    `If you have questions, reach out via in-app support.`,
    ``,
    `State Bank`,
  ].join('\n');

  const bodyHtml = [
    emailBlocks.h1(`We couldn't link ${v.institutionName}`),
    emailBlocks.para(
      `We weren't able to approve your request to link ${emailBlocks.strong(
        v.institutionName,
      )} to your account.`,
    ),
    emailBlocks.secureCallout({
      icon: 'shield',
      text: `Reason: ${reason}`,
    }),
    emailBlocks.para(
      `You can review your linked accounts or submit the request again. If you think this was a mistake, contact us via in-app support.`,
    ),
    emailBlocks.buttonGhost('Review linked accounts', linkedUrl),
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
