import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CardType } from '@prisma/client';
import { ACCOUNT_CREATED_EVENT, AccountCreatedPayload } from '../accounts/account-provisioner.service';
import { CardsService } from './cards.service';

@Injectable()
export class CardIssuerService {
  private readonly logger = new Logger(CardIssuerService.name);

  constructor(private readonly cards: CardsService) {}

  @OnEvent(ACCOUNT_CREATED_EVENT)
  async onAccountCreated(payload: AccountCreatedPayload) {
    if (payload.type !== 'checking') return;
    try {
      const card = await this.cards.issue({ accountId: payload.accountId, type: CardType.virtual });
      this.logger.log(`Issued virtual card ${card.id} for account ${payload.accountId}`);
    } catch (err) {
      this.logger.error(`Card issuance failed for ${payload.accountId}: ${(err as Error).message}`);
    }
  }
}
