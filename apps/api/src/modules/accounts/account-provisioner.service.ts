import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { AccountsService } from './accounts.service';

export const KYC_APPROVED_EVENT = 'kyc.approved';
export const ACCOUNT_CREATED_EVENT = 'account.created';

export interface KycApprovedPayload {
  userId: string;
  kycId: string;
  reviewedByUserId: string | null;
  at: Date;
}

export interface AccountCreatedPayload {
  accountId: string;
  userId: string;
  type: 'checking' | 'savings';
  at: Date;
}

@Injectable()
export class AccountProvisionerService {
  private readonly logger = new Logger(AccountProvisionerService.name);

  constructor(
    private readonly accounts: AccountsService,
    private readonly events: EventEmitter2,
  ) {}

  @OnEvent(KYC_APPROVED_EVENT)
  async onKycApproved(payload: KycApprovedPayload) {
    try {
      const { checking, savings } = await this.accounts.provisionForUser(payload.userId);
      this.logger.log(`Provisioned accounts for user ${payload.userId}: checking=${checking.id}, savings=${savings.id}`);
      const at = new Date();
      this.events.emit(ACCOUNT_CREATED_EVENT, { accountId: checking.id, userId: payload.userId, type: 'checking', at } satisfies AccountCreatedPayload);
      this.events.emit(ACCOUNT_CREATED_EVENT, { accountId: savings.id, userId: payload.userId, type: 'savings', at } satisfies AccountCreatedPayload);
    } catch (err) {
      this.logger.error(`Failed to provision accounts for ${payload.userId}: ${(err as Error).message}`);
    }
  }
}
