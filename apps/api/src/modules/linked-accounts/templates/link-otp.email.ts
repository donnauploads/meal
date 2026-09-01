/**
 * Customer-facing OTP for verifying an external-bank link request.
 * Reuses the design's code-box (emails.html section 1/2) inside the
 * shared State Bank email chrome.
 */

import { wrapEmail, emailBlocks } from '../../../common/email/templates/email-chrome';

export interface LinkOtpVars {
  institutionName: string;
  code: string;
  ttlMinutes: number;
}

export function buildLinkOtpEmail(v: LinkOtpVars) {
  const subject = `Your code to link ${v.institutionName}`;

  const text = [
    `Hi,`,
    ``,
    `Your verification code is ${v.code}.`,
    `It expires in ${v.ttlMinutes} minutes.`,
    ``,
    `You're verifying a request to link ${v.institutionName} to your State Bank account. If you didn't request this, you can safely ignore this email.`,
    ``,
    `For your security, never share this code with anyone, including someone claiming to be from the Bank.`,
    ``,
    `State Bank`,
  ].join('\n');

  const bodyHtml = [
    emailBlocks.h1('Confirm your linked account'),
    emailBlocks.para(
      `Enter the code below to verify your request to link ${emailBlocks.strong(
        v.institutionName,
      )} to your State Bank account.`,
    ),
    emailBlocks.codeBox({
      label: 'Verification code',
      code: formatCode(v.code),
      expiryNote: `This code expires in ${v.ttlMinutes} minutes`,
    }),
    emailBlocks.secureCallout({
      icon: 'shield',
      text: `If you didn't request this link, you can safely ignore this email, no account will be linked.`,
    }),
  ].join('');

  const html = wrapEmail({ title: subject, bodyHtml });

  return { subject, text, html };
}

/** Group a 6-digit code as "123 456" to match the design's code-box. */
function formatCode(code: string): string {
  return /^\d{6}$/.test(code) ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}
