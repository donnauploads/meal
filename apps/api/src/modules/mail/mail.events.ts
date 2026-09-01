/** Nest-internal event names emitted by the mail service. */
export const MAIL_NEST_EVENT = {
  MessageCreated: 'nest.mail.message_created',
} as const;

export interface MailMessageCreatedPayload {
  threadId: string;
  /** 'inbound' = customer reply just arrived; 'outbound' = admin send. */
  direction: 'outbound' | 'inbound';
  messageId: string;
  at: string;
}
