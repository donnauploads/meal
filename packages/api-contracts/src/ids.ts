declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type UserId = Brand<string, 'UserId'>;
export type AccountId = Brand<string, 'AccountId'>;
export type TransactionId = Brand<string, 'TransactionId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type CardId = Brand<string, 'CardId'>;

export const UserId = (v: string) => v as UserId;
export const AccountId = (v: string) => v as AccountId;
export const TransactionId = (v: string) => v as TransactionId;
export const SessionId = (v: string) => v as SessionId;
export const CardId = (v: string) => v as CardId;
