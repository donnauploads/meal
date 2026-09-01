import { Injectable } from '@nestjs/common';
import { LinkProvider, ExchangeResult, InstitutionListing, ProviderBalance } from './link.provider.interface';

// Placeholder. Wire to real Plaid SDK in Stage 11+ by implementing the same interface.
@Injectable()
export class PlaidProvider implements LinkProvider {
  listInstitutions(): InstitutionListing[] {
    throw new Error('Real Plaid provider not implemented');
  }
  async createLinkToken(): Promise<{ linkToken: string }> {
    throw new Error('Real Plaid provider not implemented');
  }
  async exchangePublicToken(): Promise<ExchangeResult> {
    throw new Error('Real Plaid provider not implemented');
  }
  async getBalances(): Promise<ProviderBalance[]> {
    throw new Error('Real Plaid provider not implemented');
  }
  async reauth(): Promise<{ linkToken: string }> {
    throw new Error('Real Plaid provider not implemented');
  }
}
