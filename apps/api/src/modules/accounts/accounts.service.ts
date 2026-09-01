import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccountType, Account, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountsRepository } from './accounts.repository';
import { generateMockAccountNumber, generateMockRoutingNumber } from './mock-account-numbers.util';

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: AccountsRepository,
    private readonly config: ConfigService,
  ) {}

  list(userId: string) {
    return this.repo.listForUser(userId);
  }

  async getForUser(id: string, userId: string): Promise<Account> {
    const a = await this.repo.findByIdForUser(id, userId);
    if (!a) throw new NotFoundException('Account not found');
    return a;
  }

  async getLimits(accountId: string, userId: string) {
    const a = await this.repo.findByIdForUser(accountId, userId);
    if (!a) throw new ForbiddenException('Account not accessible');
    const limits = await this.repo.findLimits(accountId);
    if (!limits) throw new NotFoundException('Limits not set');
    return limits;
  }

  async provisionForUser(userId: string): Promise<{ checking: Account; savings: Account }> {
    const existing = await this.repo.countForUser(userId);
    if (existing > 0) {
      const accs = await this.repo.listForUser(userId);
      const checking = accs.find((a) => a.type === AccountType.checking);
      const savings = accs.find((a) => a.type === AccountType.savings);
      if (checking && savings) return { checking, savings };
    }

    const apyBps = Number(this.config.get('SAVINGS_APY_BPS') ?? 450);
    // Per-account limits (in cents). Defaults match the marketing
    // ceilings shown to customers: wire $5M, mobile check $500k, cash
    // deposit $50k, card purchases $100k/day. ATM stays at $500/day.
    const limits = {
      atmDailyCents: BigInt(this.config.get<string>('CHECKING_DAILY_ATM_CENTS') ?? 50_000),
      cardPurchasesDailyCents: BigInt(this.config.get<string>('CHECKING_DAILY_PURCHASES_CENTS') ?? 10_000_000),
      cashDepositCents: BigInt(this.config.get<string>('CHECKING_CASH_DEPOSIT_CENTS') ?? 5_000_000),
      mobileCheckCents: BigInt(this.config.get<string>('CHECKING_MOBILE_CHECK_CENTS') ?? 50_000_000),
      outgoingWireCents: BigInt(this.config.get<string>('CHECKING_OUTGOING_WIRE_CENTS') ?? 500_000_000),
    };

    return this.prisma.$transaction(async (tx) => {
      const checking = await this.createAccount(tx, userId, AccountType.checking, 'Checking', null);
      await tx.accountLimits.create({ data: { accountId: checking.id, ...limits } });
      const savings = await this.createAccount(tx, userId, AccountType.savings, 'Savings', apyBps);
      return { checking, savings };
    });
  }

  private async createAccount(
    tx: Prisma.TransactionClient,
    userId: string,
    type: AccountType,
    label: string,
    apyBps: number | null,
  ): Promise<Account> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const mockAccountNumber = generateMockAccountNumber();
      try {
        return await tx.account.create({
          data: {
            userId,
            type,
            label,
            apyBps: apyBps ?? undefined,
            mockRoutingNumber: generateMockRoutingNumber(),
            mockAccountNumber,
          },
        });
      } catch (err) {
        if ((err as { code?: string }).code === 'P2002' && attempt < 4) continue;
        throw err;
      }
    }
    throw new Error('Could not allocate unique mock account number');
  }
}
