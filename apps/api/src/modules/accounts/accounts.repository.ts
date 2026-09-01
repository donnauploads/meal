import { Injectable } from '@nestjs/common';
import { Account, AccountLimits, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AccountsRepository {
  constructor(private readonly prisma: PrismaService) {}

  listForUser(userId: string): Promise<Account[]> {
    return this.prisma.account.findMany({ where: { userId }, orderBy: { openedAt: 'asc' } });
  }

  findByIdForUser(id: string, userId: string) {
    return this.prisma.account.findFirst({ where: { id, userId } });
  }

  findLimits(accountId: string): Promise<AccountLimits | null> {
    return this.prisma.accountLimits.findUnique({ where: { accountId } });
  }

  countForUser(userId: string, tx?: Prisma.TransactionClient) {
    return (tx ?? this.prisma).account.count({ where: { userId } });
  }
}
