export interface AdminDepositVars {
  userEmail: string;
  amountMinor: number;
  currency: string;
  accountId: string;
  at: Date;
}

export function buildAdminDepositEmail(v: AdminDepositVars) {
  return {
    subject: `[admin] deposit ${v.amountMinor / 100} ${v.currency}, ${v.userEmail}`,
    text: `User ${v.userEmail} deposited ${v.amountMinor / 100} ${v.currency} into account ${v.accountId} at ${v.at.toISOString()}.`,
  };
}
