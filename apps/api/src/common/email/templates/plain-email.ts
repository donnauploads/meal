/**
 * Plain, admin-authored email template for the admin Mail Desk.
 *
 * Unlike the transactional templates (which compose fixed blocks — code
 * boxes, amount panels, status pills), these emails carry free-form content
 * an admin types in the dashboard: a greeting, a rich-text body, and a
 * signature. We reuse the exact same branded shell as every other email
 * (`wrapEmail` → logo header + gold hairline + white body card + footer) and
 * only swap in the admin body, so a Customer Care / Administrator / Bank
 * Manager email looks unmistakably like the bank.
 *
 * The body HTML is sanitized upstream in the mail service (`sanitize-html`)
 * before it ever reaches here — this module only handles presentation.
 */

import { wrapEmail, emailBlocks } from './email-chrome';

const INK_SOFT = '#514D45';

export interface ComposeMailBodyInput {
  /** e.g. "Dear Mr. Ahmed," — rendered as the opening line. Optional. */
  greeting?: string;
  /** Sanitized admin-authored rich HTML (paragraphs, lists, links, images). */
  bodyHtml: string;
  /** e.g. "Warm regards,\nCustomer Care Team" — closing block. Optional. */
  signature?: string;
}

/**
 * Stitch greeting + rich body + signature into a single body fragment using
 * the brand's serif body typography. The admin body is dropped into a
 * container that sets the default font/colour so unstyled tags inherit it,
 * while any inline styles the editor produced still win.
 */
export function composeMailBody(input: ComposeMailBodyInput): string {
  const greeting = input.greeting?.trim()
    ? emailBlocks.para(escapeHtml(input.greeting.trim()))
    : '';

  const body = `<div class="body-text" style="font-family:Georgia,'Times New Roman',serif;font-size:15px;line-height:1.62;color:${INK_SOFT};">${input.bodyHtml}</div>`;

  const signature = input.signature?.trim()
    ? `<div class="body-text" style="font-family:Georgia,'Times New Roman',serif;font-size:15px;line-height:1.62;color:${INK_SOFT};margin-top:22px;">${input.signature
        .trim()
        .split('\n')
        .map((line) => escapeHtml(line))
        .join('<br />')}</div>`
    : '';

  return `${greeting}${body}${signature}`;
}

export interface WrapPlainEmailInput extends ComposeMailBodyInput {
  /** `<title>` + inbox preview text. Usually the email subject. */
  title: string;
  /**
   * Footer tail line. Defaults to a "you can reply to this email" note —
   * these are genuine two-way conversations, so the transactional
   * "do not reply" default would be wrong.
   */
  footerTail?: string;
}

/** Render a complete admin-composed email in the standard branded shell. */
export function wrapPlainEmail(input: WrapPlainEmailInput): string {
  return wrapEmail({
    title: input.title,
    bodyHtml: composeMailBody(input),
    footerTail:
      input.footerTail ??
      'You can reply directly to this email and our team will get back to you.',
  });
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
