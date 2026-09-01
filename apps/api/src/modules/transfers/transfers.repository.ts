import { Injectable } from '@nestjs/common';
import { Prisma, Transfer } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TransfersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.transfer.findUnique({ where: { id } });
  }

  findByIdempotencyKey(key: string) {
    return this.prisma.transfer.findUnique({ where: { idempotencyKey: key } });
  }

  listForUser(userId: string, limit = 50) {
    return this.prisma.transfer.findMany({
      where: { initiatedByUserId: userId },
      orderBy: { initiatedAt: 'desc' },
      take: limit,
    });
  }

  markSettled(id: string, settledTransactionId: string, tx?: Prisma.TransactionClient): Promise<Transfer> {
    const client = tx ?? this.prisma;
    return client.transfer.update({
      where: { id },
      data: { status: 'posted', settledAt: new Date(), settledTransactionId },
    });
  }

  markFailed(id: string, reason: string): Promise<Transfer> {
    return this.prisma.transfer.update({
      where: { id },
      data: { status: 'declined', failureReason: reason, settledAt: new Date() },
    });
  }
}
