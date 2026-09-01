import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Card, CardStatus, CardType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CardPanService } from '../card-pan/card-pan.service';
import { generateCvv, generateExpiry, generatePan } from './card-pan.util';

export const CARD_UPDATED_EVENT = 'card.updated';

export interface CardUpdatedPayload {
  userId: string;
  cardId: string;
  status: CardStatus;
  at: Date;
}

export interface IssueParams {
  accountId: string;
  type: CardType;
  spendingLimitCents?: bigint;
}

@Injectable()
export class CardsService {
  private readonly logger = new Logger(CardsService.name);
  private readonly bin: string;
  private readonly defaultLimit: bigint;

  constructor(
    private readonly prisma: PrismaService,
    private readonly pan: CardPanService,
    private readonly events: EventEmitter2,
    config: ConfigService,
  ) {
    this.bin = config.get<string>('CARD_DEMO_BIN') ?? '499999';
    this.defaultLimit = BigInt(config.get<string>('CARD_DEFAULT_SPENDING_LIMIT_CENTS') ?? 500_000);
  }

  async issue(params: IssueParams, tx?: Prisma.TransactionClient): Promise<Card> {
    const client = tx ?? this.prisma;
    const panStr = generatePan(this.bin);
    const cvvStr = generateCvv();
    const { expMonth, expYear } = generateExpiry();
    const panEnc = this.pan.encrypt(panStr);
    const cvvEnc = this.pan.encrypt(cvvStr);
    return client.card.create({
      data: {
        accountId: params.accountId,
        type: params.type,
        last4: panStr.slice(-4),
        expMonth,
        expYear,
        spendingLimitCents: params.spendingLimitCents ?? this.defaultLimit,
        panCiphertext: panEnc.ciphertext,
        panKeyId: panEnc.keyId,
        cvvCiphertext: cvvEnc.ciphertext,
        cvvKeyId: cvvEnc.keyId,
      },
    });
  }

  async listForUser(userId: string) {
    return this.prisma.card.findMany({
      where: { account: { userId } },
      orderBy: { issuedAt: 'desc' },
    });
  }

  async getForUser(userId: string, id: string): Promise<Card> {
    const card = await this.prisma.card.findUnique({ where: { id }, include: { account: true } });
    if (!card || card.account.userId !== userId) throw new NotFoundException('Card not found');
    return card;
  }

  async setStatus(userId: string, id: string, target: 'active' | 'frozen'): Promise<Card> {
    const card = await this.getForUser(userId, id);
    if (card.status !== CardStatus.active && card.status !== CardStatus.frozen) {
      throw new BadRequestException(`Cannot toggle a ${card.status} card`);
    }
    const updated = await this.prisma.card.update({
      where: { id },
      data: {
        status: target === 'active' ? CardStatus.active : CardStatus.frozen,
        frozenAt: target === 'frozen' ? new Date() : null,
      },
    });
    this.events.emit(CARD_UPDATED_EVENT, {
      userId,
      cardId: id,
      status: updated.status,
      at: new Date(),
    } satisfies CardUpdatedPayload);
    return updated;
  }

  async reveal(userId: string, id: string): Promise<{ pan: string; cvv: string; expMonth: number; expYear: number }> {
    const card = await this.getForUser(userId, id);
    if (card.status !== CardStatus.active) throw new BadRequestException('Cannot reveal a non-active card');
    const pan = this.pan.decrypt(Buffer.from(card.panCiphertext), card.panKeyId);
    const cvv = this.pan.decrypt(Buffer.from(card.cvvCiphertext), card.cvvKeyId);
    return { pan, cvv, expMonth: card.expMonth, expYear: card.expYear };
  }

  async replaceVirtual(userId: string, id: string): Promise<Card> {
    const card = await this.getForUser(userId, id);
    if (card.type !== CardType.virtual) throw new BadRequestException('Only virtual cards can be replaced this way');
    if (card.status !== CardStatus.active && card.status !== CardStatus.frozen) {
      throw new BadRequestException('Card is not replaceable');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.card.update({ where: { id }, data: { status: CardStatus.replaced } });
      const fresh = await this.issue({ accountId: card.accountId, type: CardType.virtual }, tx);
      await tx.card.update({ where: { id: fresh.id }, data: { replacedFromCardId: id } });
      return fresh;
    });
  }

  async orderPhysical(userId: string, accountId: string, shipAddress: object) {
    const account = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!account || account.userId !== userId) throw new ForbiddenException('Not your account');
    if (account.type !== 'checking') throw new BadRequestException('Physical cards only for checking');
    return this.prisma.cardOrder.create({
      data: { userId, shipAddress: shipAddress as object, etaDays: 7 },
    });
  }

  async activate(userId: string, cardId: string): Promise<Card> {
    const card = await this.getForUser(userId, cardId);
    if (card.status !== CardStatus.shipped && card.status !== CardStatus.delivered) {
      throw new BadRequestException('Card cannot be activated from current status');
    }
    const updated = await this.prisma.card.update({
      where: { id: cardId },
      data: { status: CardStatus.active, activatedAt: new Date() },
    });
    this.events.emit(CARD_UPDATED_EVENT, {
      userId,
      cardId,
      status: updated.status,
      at: new Date(),
    } satisfies CardUpdatedPayload);
    return updated;
  }
}
