/**
 * Sent on the `user.signed_up` event — KYC has been submitted, user is
 * "under review". Matches the design's "Registration successful" email
 * (emails.html section 3): centered gold check, detail table, gold
 * "Track your application" CTA.
 */

import { wrapEmail, emailBlocks } from '../../../../common/email/templates/email-chrome';

export interface WelcomeUserVars {
  firstName: string | null;
  webBaseUrl: string;
  /** Optional application reference (e.g. State Bank-2026-4471). Falls back
   *  to a generated placeholder if the caller doesn't supply one — the
   *  text body still works, the HTML row just shows the fallback. */
  applicationRef?: string;
  /** When the application was submitted. Defaults to `new Date()`. */
  submittedAt?: Date;
  /** Indicative time-to-decision the customer should expect. */
  typicalDecisionTime?: string;
}

export function buildWelcomeUserEmail(v: WelcomeUserVars) {
  const name = v.firstName ?? 'there';
  const submittedAt = v.submittedAt ?? new Date();
  const ref = v.applicationRef ?? defaultRef(submittedAt);
  const typicalDecision = v.typicalDecisionTime ?? '1 business day';
  const trackUrl = `${v.webBaseUrl}/profile/documents`;

  const subject = `We've received your application, welcome aboard`;

  const text = [
    `Hi ${name},`,
    ``,
    `Your application to open an account with State Bank has been received and is now with our team for review and identity verification.`,
    ``,
    `Application reference: ${ref}`,
    `Submitted:             ${submittedAt.toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' })}`,
    `Status:                Under review`,
    `Typical decision time: ${typicalDecision}`,
    ``,
    `Keep an eye on your inbox, we'll send an activation email the moment your account is approved.`,
    ``,
    `Track your application: ${trackUrl}`,
    ``,
    `State Bank`,
  ].join('\n');

  const bodyHtml = [
    emailBlocks.successIcon(),
    emailBlocks.h1('Welcome to State Bank'),
    emailBlocks.para(
      `Thank you, ${emailBlocks.strong(name)}, your application has been received successfully and is now with our team for review and identity verification.`,
    ),
    emailBlocks.detailTable([
      ['Application reference', ref],
      [
        'Submitted',
        submittedAt.toLocaleString('en-GB', {
          dateStyle: 'long',
          timeStyle: 'short',
        }),
      ],
      ['Status', 'Under review'],
      ['Typical decision time', typicalDecision],
    ]),
    emailBlocks.para(
      `${emailBlocks.strong('Keep an eye on your inbox.')} We'll send you an ${emailBlocks.strong('activation email')} the moment your account is approved, just follow the link inside to set up online banking and order your card.`,
    ),
    emailBlocks.buttonGold('Track your application', trackUrl),
  ].join('');

  const html = wrapEmail({
    title: subject,
    bodyHtml,
    footerLinks: [
      { label: 'Help Centre', href: `${v.webBaseUrl}/profile/help` },
      { label: 'Contact us', href: `${v.webBaseUrl}/profile/help` },
    ],
    footerTail: `You're receiving this because you applied for an account. <a href="${v.webBaseUrl}/privacy" style="color:#C9A24A;text-decoration:none;">Privacy Policy</a>`,
  });

  return { subject, text, html };
}

/** Produce a deterministic-looking application reference when the caller
 *  doesn't pass one — `State Bank-2026-<yyyymmdd hour>`. */
function defaultRef(at: Date): string {
  const year = at.getFullYear();
  const month = String(at.getMonth() + 1).padStart(2, '0');
  const day = String(at.getDate()).padStart(2, '0');
  const hour = String(at.getHours()).padStart(2, '0');
  return `State Bank-${year}-${month}${day}${hour}`;
}
