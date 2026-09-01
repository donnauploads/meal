export interface ProviderAccount {
  providerAccountId: string;
  institutionId: string;
  institutionName: string;
  mask: string;
  accountType: 'checking' | 'savings' | 'credit' | 'brokerage';
  balanceCents: bigint;
  available: bigint;
  iso_currency: 'USD';
}

export interface ProviderBalance {
  providerAccountId: string;
  balanceCents: bigint;
  available: bigint;
  asOf: Date;
}

export interface ExchangeResult {
  accessToken: string;
  itemId: string;
  institutionId: string;
  institutionName: string;
  accounts: ProviderAccount[];
}

export interface InstitutionListing {
  id: string;
  name: string;
  color: string;
  accountTypes: ('checking' | 'savings' | 'credit' | 'brokerage')[];
}

export interface LinkProvider {
  listInstitutions(q?: string): InstitutionListing[];
  createLinkToken(userId: string): Promise<{ linkToken: string }>;
  exchangePublicToken(publicToken: string, userId: string): Promise<ExchangeResult>;
  getBalances(accessToken: string, itemId: string, userId: string): Promise<ProviderBalance[]>;
  reauth(itemId: string): Promise<{ linkToken: string }>;
}

export const LINK_PROVIDER = Symbol('LINK_PROVIDER');
