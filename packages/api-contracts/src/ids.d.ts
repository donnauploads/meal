declare const brand: unique symbol;
type Brand<T, B extends string> = T & {
    readonly [brand]: B;
};
export type UserId = Brand<string, 'UserId'>;
export type AccountId = Brand<string, 'AccountId'>;
export type TransactionId = Brand<string, 'TransactionId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type CardId = Brand<string, 'CardId'>;
export declare const UserId: (v: string) => UserId;
export declare const AccountId: (v: string) => AccountId;
export declare const TransactionId: (v: string) => TransactionId;
export declare const SessionId: (v: string) => SessionId;
export declare const CardId: (v: string) => CardId;
export {};
