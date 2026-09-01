export interface AdminWithdrawalVars {
  userEmail: string;
  amountMinor: number;
  currency: string;
  accountId: string;
  at: Date;
}

export function buildAdminWithdrawalEmail(v: AdminWithdrawalVars) {
  return {
    subject: `[admin] withdrawal ${v.amountMinor / 100} ${v.currency}, ${v.userEmail}`,
    text: `User ${v.userEmail} withdrew ${v.amountMinor / 100} ${v.currency} from account ${v.accountId} at ${v.at.toISOString()}.`,
  };
}
