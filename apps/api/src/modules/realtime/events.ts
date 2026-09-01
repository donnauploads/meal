// Mirrors @bank-demo/api-contracts. Kept local so apps/api compiles with its
// own rootDir; sync with packages/api-contracts/src/events.ts when changed.
export const REALTIME_EVENT = {
  SessionRevoked: 'session.revoked',
  TransactionPosted: 'transaction.posted',
  AccountBalanceUpdated: 'account.balance.updated',
} as const;
export type RealtimeEvent =
  | { type: 'transaction.posted'; userId: string; accountId: string; transactionId: string; at: string }
  | { type: 'account.balance.updated'; userId: string; accountId: string; balanceMinor: number; at: string }
  | { type: 'session.revoked'; userId: string; sessionId: string; reason: string; at: string };

export const NEST_EVENT = {
  SessionRevoked: 'nest.session.revoked',
  SessionCreated: 'nest.session.created',
  TransactionCreated: 'nest.transaction.created',
  TransactionSettled: 'nest.transaction.settled',
  TransactionUpdated: 'nest.transaction.updated',
  AccountBalanceChanged: 'nest.account.balance_changed',
  AdminTransferSettled: 'admin.transfer.settled',
  LinkedAccountChanged: 'nest.linked_account.changed',
  AdminMessage: 'nest.admin.message',
} as const;

export interface NestSessionRevokedPayload {
  userId: string;
  sessionId: string;
  reason: string;
  at: Date;
}

export interface NestSessionCreatedPayload {
  userId: string;
  sessionId: string;
  deviceId: string;
  ip: string;
  at: Date;
}

export interface NestTransactionCreatedPayload {
  userId: string;
  accountId: string;
  transactionId: string;
  amountCents: string;
  status: string;
  at: Date;
  /** Display fields included so the customer renders the real row on the
   *  first push, no refetch needed. All optional so existing emitters that
   *  haven't been updated keep compiling. */
  description?: string;
  category?: string;
  occurredAt?: string;
  kind?: string;
}

export interface NestTransactionSettledPayload {
  userId: string;
  accountId: string;
  transactionId: string;
  transferId: string;
  amountCents: string;
  at: Date;
}

export interface NestAccountBalanceChangedPayload {
  userId: string;
  accountId: string;
  balanceCents: string;
  at: Date;
}

export interface NestTransactionUpdatedPayload {
  userId: string;
  accountId: string;
  transactionId: string;
  effective: {
    amountCents: string;
    occurredAt: string;
    description: string;
    category: string;
    status: string;
  } | null;
  hidden: boolean;
  at: Date;
}

export interface AdminTransferSettledPayload {
  transferId: string;
  userId: string;
  direction: 'deposit' | 'withdrawal';
  amountCents: bigint;
  kind: string;
  settledAt: Date;
}

export interface LinkedAccountChangedPayload {
  userId: string;
  requestId: string;
  /** What happened — submitted | approved | rejected | deleted (admin hard-delete). */
  kind: 'submitted' | 'approved' | 'rejected' | 'deleted';
  at: Date;
}

/** Real-time "popup" message an admin pushes to a single user's dashboard.
 *  Distinct from a notification — it surfaces as a modal, not the bell. */
export interface NestAdminMessagePayload {
  userId: string;
  messageId: string;
  title: string;
  body: string;
  at: Date;
}
