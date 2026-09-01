import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PaymentRequestStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PayService } from '../pay/pay.service';
import { TransfersService } from '../transfers/transfers.service';
import { CreatePaymentRequestDto } from '../pay/dto/pay.dto';

export const PAYMENT_REQUESTED_EVENT = 'payment.requested';

@Injectable()
export class PaymentRequestsService {
  private readonly ttlDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly payService: PayService,
    private readonly transfers: TransfersService,
    private readonly events: EventEmitter2,
    config: ConfigService,
  ) {
    this.ttlDays = Number(config.get('PAYMENT_REQUEST_TTL_DAYS') ?? 14);
  }

  async create(requesterUserId: string, dto: CreatePaymentRequestDto) {
    const payer = await this.payService.resolveRecipient(dto.payerHandleOrId);
    if (payer.id === requesterUserId) throw new BadRequestException('Cannot request from yourself');

    const expiresAt = new Date(Date.now() + this.ttlDays * 24 * 60 * 60 * 1000);
    const row = await this.prisma.paymentRequest.create({
      data: {
        requesterUserId,
        payerUserId: payer.id,
        amountCents: dto.amountCents,
        note: dto.note,
        expiresAt,
      },
    });
    this.events.emit(PAYMENT_REQUESTED_EVENT, {
      requestId: row.id,
      requesterUserId,
      payerUserId: payer.id,
      amountCents: row.amountCents.toString(),
      note: row.note,
      at: row.createdAt,
    });
    return row;
  }

  list(userId: string, role: 'inbox' | 'sent') {
    if (role === 'inbox') {
      return this.prisma.paymentRequest.findMany({
        where: { payerUserId: userId },
        orderBy: { createdAt: 'desc' },
      });
    }
    return this.prisma.paymentRequest.findMany({
      where: { requesterUserId: userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async decline(userId: string, id: string) {
    const row = await this.prisma.paymentRequest.findUnique({ where: { id } });
    if (!row || row.payerUserId !== userId) throw new NotFoundException('Request not found');
    if (row.status !== PaymentRequestStatus.pending) throw new BadRequestException('Not pending');
    return this.prisma.paymentRequest.update({
      where: { id },
      data: { status: PaymentRequestStatus.declined },
    });
  }

  async pay(userId: string, id: string, idempotencyKey: string, fromAccountId: string) {
    const row = await this.prisma.paymentRequest.findUnique({ where: { id } });
    if (!row || row.payerUserId !== userId) throw new NotFoundException('Request not found');
    if (row.status !== PaymentRequestStatus.pending) throw new BadRequestException('Not pending');
    if (row.expiresAt < new Date()) {
      await this.prisma.paymentRequest.update({ where: { id }, data: { status: PaymentRequestStatus.expired } });
      throw new BadRequestException('Request expired');
    }

    const requesterChecking = await this.prisma.account.findFirst({
      where: { userId: row.requesterUserId, type: 'checking', status: 'active' },
    });
    if (!requesterChecking) throw new BadRequestException('Requester has no active checking account');

    const result = await this.transfers.initiate(userId, idempotencyKey, {
      fromAccountId,
      toAccountId: requesterChecking.id,
      kind: 'p2p',
      amountCents: row.amountCents,
      instant: false,
      note: row.note,
    });

    const updated = await this.prisma.paymentRequest.update({
      where: { id },
      data: {
        status: PaymentRequestStatus.paid,
        paidAt: new Date(),
        paidTransferId: result.transferId,
      },
    });
    return { request: updated, transfer: result };
  }
}
