import type { AccountId, SessionId, TransactionId, UserId } from './ids';
import type { SessionRevokedReason } from './enums';

export type RealtimeEvent =
  | { type: 'transaction.posted'; userId: UserId; accountId: AccountId; transactionId: TransactionId; at: string }
  | { type: 'account.balance.updated'; userId: UserId; accountId: AccountId; balanceMinor: number; at: string }
  | { type: 'session.revoked'; userId: UserId; sessionId: SessionId; reason: SessionRevokedReason; at: string };

export type RealtimeEventType = RealtimeEvent['type'];

export const REALTIME_EVENT = {
  SessionRevoked: 'session.revoked',
  TransactionPosted: 'transaction.posted',
  AccountBalanceUpdated: 'account.balance.updated',
} as const;
