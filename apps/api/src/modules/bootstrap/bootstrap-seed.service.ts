import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AccountStatus,
  AccountType,
  KycStatus,
  Prisma,
  UserRole,
  UserStatus,
} from '@prisma/client';
import { randomInt } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { Argon2Service } from '../crypto/argon2.service';

/** Same demo routing number the persona seed uses. */
const DEMO_ROUTING = '021000099';

function mockAccountNumber(): string {
  let n = '';
  for (let i = 0; i < 12; i++) n += randomInt(0, 10).toString();
  return n;
}

function splitName(
  name: string | undefined,
  fallbackFirst: string,
): { firstName: string; lastName: string | null } {
  const n = (name ?? '').trim();
  if (!n) return { firstName: fallbackFirst, lastName: null };
  const [first, ...rest] = n.split(/\s+/);
  return { firstName: first, lastName: rest.length ? rest.join(' ') : null };
}

/**
 * Guarantees a baseline admin + customer account exist on whatever database
 * the app is currently pointed at. Runs on every startup (so a fresh DATABASE_URL
 * + redeploy self-seeds), and is strictly create-if-missing — it never
 * overwrites an existing account's password. Driven entirely by env:
 *
 *   SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD [/ SEED_ADMIN_NAME]
 *   SEED_USER_EMAIL  / SEED_USER_PASSWORD  [/ SEED_USER_NAME]
 *
 * A pair is skipped unless BOTH its email and password are set, so leaving the
 * vars blank (e.g. in local dev) makes this a no-op. Seeding failures are
 * logged but never block startup.
 */
@Injectable()
export class BootstrapSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(BootstrapSeedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly argon: Argon2Service,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const adminEmail = this.config.get<string>('SEED_ADMIN_EMAIL')?.trim();
    const adminPassword = this.config.get<string>('SEED_ADMIN_PASSWORD');
    if (adminEmail && adminPassword) {
      await this.ensureUser({
        email: adminEmail,
        password: adminPassword,
        role: UserRole.admin,
        name: this.config.get<string>('SEED_ADMIN_NAME'),
        provisionAccounts: false,
      });
    }

    const userEmail = this.config.get<string>('SEED_USER_EMAIL')?.trim();
    const userPassword = this.config.get<string>('SEED_USER_PASSWORD');
    if (userEmail && userPassword) {
      await this.ensureUser({
        email: userEmail,
        password: userPassword,
        role: UserRole.customer,
        name: this.config.get<string>('SEED_USER_NAME'),
        provisionAccounts: true,
      });
    }
  }

  private async ensureUser(input: {
    email: string;
    password: string;
    role: UserRole;
    name?: string;
    provisionAccounts: boolean;
  }): Promise<void> {
    const email = input.email.trim();
    try {
      const existing = await this.prisma.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
        select: { id: true },
      });
      if (existing) {
        this.logger.log(`Bootstrap ${input.role}: "${email}" already present — skipping.`);
        return;
      }

      const passwordHash = await this.argon.hash(input.password);
      const { firstName, lastName } = splitName(
        input.name,
        input.role === UserRole.admin ? 'Admin' : 'Account',
      );

      await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email,
            passwordHash,
            firstName,
            lastName,
            role: input.role,
            status: UserStatus.active,
          },
        });
        // KYC pre-approved so the seeded account can use the app without
        // going through the review gate.
        await tx.kycRecord.create({
          data: {
            userId: user.id,
            status: KycStatus.approved,
            reviewedAt: new Date(),
            missingFields: [],
          },
        });
        if (input.provisionAccounts) {
          const checking = await tx.account.create({
            data: {
              userId: user.id,
              type: AccountType.checking,
              label: 'Checking',
              mockRoutingNumber: DEMO_ROUTING,
              mockAccountNumber: mockAccountNumber(),
              status: AccountStatus.active,
            },
          });
          await tx.accountLimits.create({
            data: {
              accountId: checking.id,
              atmDailyCents: 50_000n,
              cardPurchasesDailyCents: 10_000_000n,
              cashDepositCents: 5_000_000n,
              mobileCheckCents: 50_000_000n,
              outgoingWireCents: 500_000_000n,
            },
          });
          await tx.account.create({
            data: {
              userId: user.id,
              type: AccountType.savings,
              label: 'Savings',
              mockRoutingNumber: DEMO_ROUTING,
              mockAccountNumber: mockAccountNumber(),
              status: AccountStatus.active,
              apyBps: 450,
            },
          });
        }
      });

      this.logger.log(
        `Bootstrap ${input.role}: created "${email}"${
          input.provisionAccounts ? ' with checking + savings' : ''
        }.`,
      );
    } catch (err) {
      // A concurrent instance winning the create() shows up as P2002 — benign.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        this.logger.log(`Bootstrap ${input.role}: "${email}" created concurrently — skipping.`);
        return;
      }
      // Never take the API down over a seeding hiccup (e.g. DB cold-start).
      this.logger.error(
        `Bootstrap seed for "${email}" failed (continuing startup): ${(err as Error).message}`,
      );
    }
  }
}
