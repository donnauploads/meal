export interface EmailAttachmentInput {
  filename: string;
  contentType: string;
  bytes: Buffer;
}

export interface TransactionalEmailInput {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  attachments?: EmailAttachmentInput[];
  /**
   * Override the From: identity for this message (e.g. an admin "desk"
   * address like `State Bank Customer Care <care@cbbank.bh>`).
   * Falls back to the provider's configured default when omitted.
   */
  from?: string;
  /** Reply-To address — e.g. a per-thread routing address for inbound. */
  replyTo?: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  /**
   * Extra RFC headers — used for email threading
   * (`In-Reply-To`, `References`).
   */
  headers?: Record<string, string>;
}

export interface EmailProvider {
  send(input: TransactionalEmailInput): Promise<{ messageId: string }>;
}

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
