import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class AdminTransactionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findWithOverride(id: string) {
    return this.prisma.transaction.findUnique({
      where: { id },
      include: { account: true, override: true },
    });
  }

  async list(filters: {
    userId?: string;
    accountId?: string;
    from?: Date;
    to?: Date;
    cursorOccurredAt?: Date;
    cursorId?: string;
    limit: number;
  }) {
    const where: Record<string, unknown> = {};
    if (filters.accountId) where.accountId = filters.accountId;
    else if (filters.userId) where.account = { userId: filters.userId };

    if (filters.from || filters.to) {
      const range: Record<string, Date> = {};
      if (filters.from) range.gte = filters.from;
      if (filters.to) range.lte = filters.to;
      where.occurredAt = range;
    }

    if (filters.cursorOccurredAt && filters.cursorId) {
      where.AND = [
        {
          OR: [
            { occurredAt: { lt: filters.cursorOccurredAt } },
            { occurredAt: filters.cursorOccurredAt, id: { lt: filters.cursorId } },
          ],
        },
      ];
    }

    return this.prisma.transaction.findMany({
      where,
      include: { override: true, account: { select: { userId: true } } },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: filters.limit + 1,
    });
  }
}
