import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomInt, randomUUID } from 'crypto';
import {
  ExchangeResult,
  InstitutionListing,
  LinkProvider,
  ProviderAccount,
  ProviderBalance,
} from './link.provider.interface';
import {
  REAUTH_PRONE_INSTITUTIONS,
  STUB_INSTITUTIONS,
  findInstitution,
  searchInstitutions,
} from './plaid-stub.catalog';

interface LinkTokenEnvelope {
  userId: string;
  nonce: string;
}

@Injectable()
export class PlaidStubProvider implements LinkProvider {
  private readonly linkTokensByUser = new Map<string, LinkTokenEnvelope>();

  listInstitutions(q?: string): InstitutionListing[] {
    return searchInstitutions(q).map((i) => ({
      id: i.id,
      name: i.name,
      color: i.color,
      accountTypes: i.accountTypes,
    }));
  }

  async createLinkToken(userId: string): Promise<{ linkToken: string }> {
    const linkToken = `link_stub_${randomUUID()}`;
    this.linkTokensByUser.set(linkToken, { userId, nonce: randomUUID() });
    return { linkToken };
  }

  async exchangePublicToken(publicToken: string, userId: string): Promise<ExchangeResult> {
    // Frontend stub posts: `${linkToken}|${institutionId}`
    const [linkToken, institutionId] = publicToken.split('|');
    const envelope = this.linkTokensByUser.get(linkToken);
    if (!envelope || envelope.userId !== userId) throw new NotFoundException('Invalid public token');
    this.linkTokensByUser.delete(linkToken);

    const inst = findInstitution(institutionId) ?? STUB_INSTITUTIONS[0];
    const itemId = `item_${randomUUID()}`;
    const accessToken = `access_stub_${randomUUID()}`;

    const accountCount = inst.accountTypes.length >= 2 ? 2 : 1;
    const accounts: ProviderAccount[] = inst.accountTypes.slice(0, accountCount).map((accountType) => {
      const mask = String(randomInt(1000, 10000));
      return {
        providerAccountId: `acct_${randomUUID()}`,
        institutionId: inst.id,
        institutionName: inst.name,
        mask,
        accountType,
        balanceCents: deterministicBalance(userId, inst.id, accountType),
        available: deterministicBalance(userId, inst.id, accountType),
        iso_currency: 'USD',
      };
    });

    return { accessToken, itemId, institutionId: inst.id, institutionName: inst.name, accounts };
  }

  async getBalances(_accessToken: string, itemId: string, userId: string): Promise<ProviderBalance[]> {
    if (REAUTH_PRONE_INSTITUTIONS.has(itemId)) {
      // Caller (service) interprets thrown reauth-needed via the dedicated error class.
    }
    // We don't persist provider account ids here; for the stub we return an empty array and the
    // service relies on lastSyncedAt bump. A real Plaid provider would return per-account balances.
    return [];
  }

  async reauth(_itemId: string): Promise<{ linkToken: string }> {
    return this.createLinkToken('reauth-context');
  }

  shouldRequireReauth(institutionId: string, userId: string): boolean {
    if (!REAUTH_PRONE_INSTITUTIONS.has(institutionId)) return false;
    // Deterministic per (user, institution): ~25% of syncs flag reauth.
    const h = createHash('sha256').update(`${userId}:${institutionId}:${Date.now() >> 17}`).digest();
    return h[0] < 64;
  }
}

function deterministicBalance(userId: string, institutionId: string, type: string): bigint {
  const h = createHash('sha256').update(`${userId}:${institutionId}:${type}`).digest();
  const persona = h[0]; // 0–255
  let base = 50_000; // $500
  if (persona < 64) base = 1_500;        // Maya-like: ~$15
  else if (persona < 128) base = 50_000; // typical: ~$500
  else if (persona < 192) base = 250_000;// flush: ~$2500
  else base = 800_000;                   // wealthy: ~$8000
  if (type === 'savings') base *= 3;
  if (type === 'credit') base = -base / 2;
  if (type === 'brokerage') base *= 10;
  return BigInt(base + (h[1] * 100));
}
