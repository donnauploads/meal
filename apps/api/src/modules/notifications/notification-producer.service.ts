import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationCategory } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  NEST_EVENT,
  NestSessionCreatedPayload,
  NestTransactionSettledPayload,
  AdminTransferSettledPayload,
} from '../realtime/events';
import { CARD_UPDATED_EVENT, CardUpdatedPayload } from '../cards/cards.service';
import { PAYMENT_REQUESTED_EVENT } from '../payment-requests/payment-requests.service';
import { NotificationsService } from './notifications.service';

@Injectable()
export class NotificationProducerService {
  private readonly logger = new Logger(NotificationProducerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  @OnEvent(NEST_EVENT.TransactionSettled)
  async onTxSettled(payload: NestTransactionSettledPayload) {
    try {
      const prefs = await this.notifications.getPreferences(payload.userId);
      if (!prefs.txAll) return;
      const amount = BigInt(payload.amountCents);
      const absAmount = amount < 0n ? -amount : amount;
      if (prefs.txLargeOnly && absAmount < prefs.txLargeThresholdCents) return;

      const direction = amount < 0n ? 'sent' : 'received';
      const dollars = formatUsd(absAmount);
      await this.notifications.create({
        userId: payload.userId,
        category: NotificationCategory.transaction,
        title: `Transaction posted`,
        body: `You ${direction} $${dollars}.`,
        ctaUrl: `/home/spending`,
      });
    } catch (err) {
      this.logger.warn(`tx settled notification failed: ${(err as Error).message}`);
    }
  }

  @OnEvent(NEST_EVENT.SessionCreated)
  async onSessionCreated(payload: NestSessionCreatedPayload) {
    try {
      const prefs = await this.notifications.getPreferences(payload.userId);
      if (!prefs.securityAlerts) return;
      await this.notifications.create({
        userId: payload.userId,
        category: NotificationCategory.security,
        title: 'New sign-in to your account',
        body: `A new session was started at ${payload.at.toISOString()}.`,
        ctaUrl: '/profile/security',
      });
    } catch (err) {
      this.logger.warn(`session created notification failed: ${(err as Error).message}`);
    }
  }

  @OnEvent(CARD_UPDATED_EVENT)
  async onCardUpdated(payload: CardUpdatedPayload) {
    try {
      const prefs = await this.notifications.getPreferences(payload.userId);
      if (!prefs.securityAlerts) return;
      const verb = payload.status === 'frozen' ? 'frozen' : payload.status === 'active' ? 'unfrozen' : payload.status;
      await this.notifications.create({
        userId: payload.userId,
        category: NotificationCategory.security,
        title: `Card ${verb}`,
        body: `Your card was ${verb}.`,
        ctaUrl: '/home/spending/card',
      });
    } catch (err) {
      this.logger.warn(`card updated notification failed: ${(err as Error).message}`);
    }
  }

  @OnEvent(PAYMENT_REQUESTED_EVENT)
  async onPaymentRequested(payload: { payerUserId: string; amountCents: string; note: string; requestId: string }) {
    try {
      const dollars = formatUsd(BigInt(payload.amountCents));
      await this.notifications.create({
        userId: payload.payerUserId,
        category: NotificationCategory.transaction,
        title: 'New payment request',
        body: `Someone requested $${dollars}: ${payload.note}`,
        ctaUrl: '/pay',
      });
    } catch (err) {
      this.logger.warn(`payment request notification failed: ${(err as Error).message}`);
    }
  }

  @OnEvent(NEST_EVENT.AdminTransferSettled)
  async onAdminTransfer(_payload: AdminTransferSettledPayload) {
    // No-op for the user-facing producer; the admin email pipeline handles ops side.
  }
}

/**
 * Format a positive cents bigint as a USD amount with thousand
 * separators ("2345.00" → "2,345.00"). BigInt can exceed Number's safe
 * range so we split-and-stitch the dollars portion via regex instead of
 * calling `toLocaleString`.
 */
function formatUsd(cents: bigint): string {
  const abs = cents < 0n ? -cents : cents;
  const dollars = abs / 100n;
  const remainder = abs % 100n;
  const withCommas = dollars
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${withCommas}.${remainder.toString().padStart(2, '0')}`;
}
