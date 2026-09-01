import { Injectable } from '@nestjs/common';
import { Prisma, Transaction, TransactionCategory, TransactionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export interface ListFilters {
  accountIds: string[];
  cursorOccurredAt?: Date;
  cursorId?: string;
  limit: number;
  q?: string;
  categories?: TransactionCategory[];
  status?: TransactionStatus;
  from?: Date;
  to?: Date;
}

@Injectable()
export class TransactionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: ListFilters): Promise<Transaction[]> {
    const where: Prisma.TransactionWhereInput = { accountId: { in: filters.accountIds } };
    if (filters.status) where.status = filters.status;
    if (filters.categories?.length) where.category = { in: filters.categories };
    if (filters.from || filters.to) {
      where.occurredAt = {};
      if (filters.from) where.occurredAt.gte = filters.from;
      if (filters.to) where.occurredAt.lte = filters.to;
    }
    if (filters.q) {
      where.OR = [
        { description: { contains: filters.q, mode: 'insensitive' } },
        { merchant: { name: { contains: filters.q, mode: 'insensitive' } } },
      ];
    }
    if (filters.cursorOccurredAt && filters.cursorId) {
      where.AND = [
        ...((where.AND as Prisma.TransactionWhereInput[]) ?? []),
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
      include: { merchant: true, override: true },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: filters.limit + 1,
    });
  }

  findById(id: string) {
    return this.prisma.transaction.findUnique({
      where: { id },
      include: { merchant: true, account: true, override: true },
    });
  }
}
