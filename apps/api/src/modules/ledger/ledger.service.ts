import { Injectable, Logger } from '@nestjs/common';
import { LedgerAccount, LedgerAccountType, PostingDirection, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  SYSTEM_LEDGER_SEEDS,
  accountSubLedgerCode,
} from './chart-of-accounts';

export interface PostingInput {
  code: string;
  direction: PostingDirection;
  amountCents: bigint;
  meta?: { ownerUserId?: string; type?: LedgerAccountType; normalBalance?: PostingDirection };
}

export interface JournalInput {
  description: string;
  occurredAt: Date;
  source: string;
  referenceId?: string;
  postings: PostingInput[];
}

@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async ensureSystemAccounts(): Promise<void> {
    for (const seed of SYSTEM_LEDGER_SEEDS) {
      await this.prisma.ledgerAccount.upsert({
        where: { code: seed.code },
        update: {},
        create: seed,
      });
    }
  }

  async ensureAccountLedger(accountId: string, ownerUserId: string, tx?: Prisma.TransactionClient): Promise<LedgerAccount> {
    const client = tx ?? this.prisma;
    return client.ledgerAccount.upsert({
      where: { code: accountSubLedgerCode(accountId) },
      update: {},
      create: {
        code: accountSubLedgerCode(accountId),
        type: LedgerAccountType.liability,
        normalBalance: PostingDirection.credit,
        ownerUserId,
      },
    });
  }

  async post(tx: Prisma.TransactionClient, input: JournalInput): Promise<string> {
    if (input.postings.length < 2) {
      throw new Error('Journal entry requires at least 2 postings');
    }
    const sumDebit = input.postings.filter((p) => p.direction === 'debit').reduce((a, p) => a + p.amountCents, 0n);
    const sumCredit = input.postings.filter((p) => p.direction === 'credit').reduce((a, p) => a + p.amountCents, 0n);
    if (sumDebit !== sumCredit) {
      throw new Error(`Unbalanced journal: debits=${sumDebit} credits=${sumCredit}`);
    }

    const codes = Array.from(new Set(input.postings.map((p) => p.code)));
    const existing = await tx.ledgerAccount.findMany({ where: { code: { in: codes } } });
    const byCode = new Map(existing.map((a) => [a.code, a]));

    for (const p of input.postings) {
      if (!byCode.has(p.code)) {
        const meta = p.meta;
        if (!meta?.type || !meta?.normalBalance) {
          throw new Error(`Unknown ledger account ${p.code} and no meta provided to create it`);
        }
        const created = await tx.ledgerAccount.create({
          data: { code: p.code, type: meta.type, normalBalance: meta.normalBalance, ownerUserId: meta.ownerUserId },
        });
        byCode.set(created.code, created);
      }
    }

    const entry = await tx.journalEntry.create({
      data: {
        description: input.description,
        occurredAt: input.occurredAt,
        source: input.source,
        referenceId: input.referenceId,
      },
    });

    await tx.posting.createMany({
      data: input.postings.map((p) => ({
        journalEntryId: entry.id,
        ledgerAccountId: byCode.get(p.code)!.id,
        direction: p.direction,
        amountCents: p.amountCents,
      })),
    });

    return entry.id;
  }
}
