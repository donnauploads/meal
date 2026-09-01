/**
 * Verification-code email — covers both signup enrolment and sign-in
 * MFA. Returns plain text + HTML; the EmailService forwards `html` to
 * the provider so HTML-capable clients render the design's banner,
 * code box, and security callout while text-only fallbacks still work.
 */

import { wrapEmail, emailBlocks } from '../../../common/email/templates/email-chrome';

export type VerificationCodeKind = 'signup' | 'signin' | 'recovery';

export interface VerificationCodeEmailVars {
  code: string;
  ttlMinutes: number;
  /** Defaults to `'signup'` to preserve the prior call-site behaviour
   *  that didn't pass a kind. */
  kind?: VerificationCodeKind;
}

export function buildVerificationCodeEmail(v: VerificationCodeEmailVars) {
  const kind: VerificationCodeKind = v.kind ?? 'signup';
  const isSignup = kind === 'signup';

  const subject =
    kind === 'signup'
      ? `Your State Bank verification code`
      : kind === 'signin'
        ? `Your sign-in code is ${v.code}`
        : `Your password reset code is ${v.code}`;

  const text =
    kind === 'signup'
      ? [
          `Welcome to State Bank.`,
          ``,
          `Your verification code: ${v.code}`,
          `It expires in ${v.ttlMinutes} minutes.`,
          ``,
          `For your security, never share this code with anyone, including someone claiming to be from the Bank.`,
          ``,
          `If you didn't request this, you can safely ignore this email.`,
        ].join('\n')
      : kind === 'signin'
        ? [
            `Your State Bank sign-in code: ${v.code}`,
            ``,
            `It's valid for ${v.ttlMinutes} minutes and can only be used once.`,
            ``,
            `Didn't try to sign in? Don't enter this code. Change your password immediately and contact us.`,
          ].join('\n')
        : [
            `Your State Bank password reset code: ${v.code}`,
            ``,
            `It's valid for ${v.ttlMinutes} minutes and can only be used once.`,
            ``,
            `If you didn't request a password reset, you can safely ignore this email, your password hasn't changed.`,
          ].join('\n');

  const bodyHtml =
    kind === 'signup'
      ? renderSignupBody(v)
      : kind === 'signin'
        ? renderSigninBody(v)
        : renderRecoveryBody(v);

  const html = wrapEmail({
    title: subject,
    bodyHtml,
  });

  return { subject, text, html };
}

function renderSignupBody(v: VerificationCodeEmailVars): string {
  return [
    emailBlocks.h1('Confirm your email address'),
    emailBlocks.para(
      `Welcome to State Bank. To continue opening your account, enter the verification code below on the screen where you left off.`,
    ),
    emailBlocks.codeBox({
      label: 'Verification code',
      code: spaceCode(v.code),
      expiryNote: `This code expires in ${v.ttlMinutes} minutes`,
    }),
    emailBlocks.para(
      `For your security, never share this code with anyone, including someone claiming to be from the Bank. We will never call, text or email you to ask for it.`,
    ),
    emailBlocks.secureCallout({
      icon: 'lock',
      text: `If you didn't request this, you can safely ignore this email, your address won't be used to create an account.`,
    }),
  ].join('');
}

function renderSigninBody(v: VerificationCodeEmailVars): string {
  return [
    emailBlocks.h1('Your sign-in code'),
    emailBlocks.para(
      `We received a request to sign in to your online banking. Enter this code to finish signing in.`,
    ),
    emailBlocks.codeBox({
      label: 'One-time code',
      code: spaceCode(v.code),
      expiryNote: `Valid for ${v.ttlMinutes} minutes · single use`,
    }),
    emailBlocks.para(
      `${emailBlocks.strong("Didn't try to sign in?")} Do not enter this code. Someone may have your password, please change it immediately and contact us.`,
    ),
    emailBlocks.secureCallout({
      icon: 'shield-check',
      text: `State Bank will never ask you to read out or share this code. Keep it to yourself.`,
    }),
  ].join('');
}

function renderRecoveryBody(v: VerificationCodeEmailVars): string {
  return [
    emailBlocks.h1('Reset your password'),
    emailBlocks.para(
      `We received a request to reset your State Bank password. Enter the code below on the screen where you left off to choose a new password.`,
    ),
    emailBlocks.codeBox({
      label: 'Password reset code',
      code: spaceCode(v.code),
      expiryNote: `Valid for ${v.ttlMinutes} minutes · single use`,
    }),
    emailBlocks.para(
      `${emailBlocks.strong("Didn't request this?")} You can safely ignore this email, your password hasn't changed. If you're worried someone else is trying to access your account, contact us right away.`,
    ),
    emailBlocks.secureCallout({
      icon: 'lock',
      text: `State Bank will never ask you to read out or share this code. Keep it to yourself.`,
    }),
  ].join('');
}

/** Drop a thin space in the middle of a 6-digit code so the rendered
 *  display reads as "482 913" (matches the design's letter-spacing
 *  pattern). Leaves non-6-digit codes alone. */
function spaceCode(code: string): string {
  if (/^\d{6}$/.test(code)) return `${code.slice(0, 3)} ${code.slice(3)}`;
  return code;
}
