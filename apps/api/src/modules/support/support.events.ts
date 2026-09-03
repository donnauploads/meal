export const SUPPORT_NEST_EVENT = {
  MessageCreated: 'nest.support.message_created',
  MessagesRead: 'nest.support.messages_read',
  ThreadClosed: 'nest.support.thread_closed',
} as const;

export const SUPPORT_REALTIME_EVENT = {
  MessageCreated: 'support.message.created',
  MessagesRead: 'support.messages.read',
  Typing: 'support.typing',
  ThreadClosed: 'support.thread.closed',
} as const;

export interface SupportThreadClosedPayload {
  threadId: string;
  /** Null for GUEST threads — the gateway then routes to the guest room. */
  customerUserId: string | null;
  closedByUserId: string;
  closedAt: string;
}

export interface SupportMessagesReadPayload {
  threadId: string;
  customerUserId: string;
  messageIds: string[];
  readAt: string;
}

export interface SupportMessageDto {
  id: string;
  threadId: string;
  /** Null for guest-authored messages (no user account). */
  senderId: string | null;
  senderRole: 'customer' | 'admin' | 'guest';
  body: string;
  createdAt: string;
  /** Present only on messages carrying a file. The bytes are NOT inlined —
   *  clients fetch them from the authenticated attachment endpoint by id. */
  attachment?: {
    name: string;
    type: string;
    size: number;
    kind: 'image' | 'file';
  } | null;
}

export interface SupportMessageCreatedPayload {
  threadId: string;
  /** Null for GUEST threads — the gateway then routes to the guest room. */
  customerUserId: string | null;
  message: SupportMessageDto;
  at: Date;
}
