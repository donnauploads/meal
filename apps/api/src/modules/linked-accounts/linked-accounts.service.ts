import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { LinkedAccount, LinkedAccountStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AesGcmService } from '../crypto/aes-gcm.service';
import { LINK_PROVIDER, LinkProvider } from './providers/link.provider.interface';
import { PlaidStubProvider } from './providers/plaid-stub.provider';

@Injectable()
export class LinkedAccountsService {
  private readonly logger = new Logger(LinkedAccountsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aes: AesGcmService,
    @Inject(LINK_PROVIDER) private readonly provider: LinkProvider,
  ) {}

  listInstitutions(q?: string) {
    return this.provider.listInstitutions(q);
  }

  async createLinkToken(userId: string) {
    return this.provider.createLinkToken(userId);
  }

  async exchange(userId: string, publicToken: string) {
    const result = await this.provider.exchangePublicToken(publicToken, userId);
    const enc = Buffer.from(this.aes.encrypt(result.accessToken), 'base64');

    const rows: LinkedAccount[] = [];
    for (const acct of result.accounts) {
      const row = await this.prisma.linkedAccount.create({
        data: {
          userId,
          providerItemId: result.itemId,
          institutionId: result.institutionId,
          institutionName: result.institutionName,
          mask: acct.mask,
          accountType: acct.accountType,
          accessTokenEnc: enc,
          status: LinkedAccountStatus.connected,
          lastSyncedAt: new Date(),
        },
      });
      rows.push(row);
    }
    return rows;
  }

  list(userId: string) {
    return this.prisma.linkedAccount.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async sync(userId: string, id: string): Promise<LinkedAccount> {
    const row = await this.prisma.linkedAccount.findUnique({ where: { id } });
    if (!row || row.userId !== userId) throw new NotFoundException('Linked account not found');
    if (row.status === LinkedAccountStatus.disconnected) {
      throw new NotFoundException('Linked account disconnected');
    }

    if (this.provider instanceof PlaidStubProvider && this.provider.shouldRequireReauth(row.institutionId, userId)) {
      return this.prisma.linkedAccount.update({
        where: { id: row.id },
        data: { status: LinkedAccountStatus.requires_reauth, lastSyncedAt: new Date() },
      });
    }

    try {
      const accessToken = this.aes.decrypt(Buffer.from(row.accessTokenEnc).toString('base64'));
      await this.provider.getBalances(accessToken, row.providerItemId, userId);
    } catch (err) {
      this.logger.warn(`sync getBalances failed for ${row.id}: ${(err as Error).message}`);
    }

    return this.prisma.linkedAccount.update({
      where: { id: row.id },
      data: { lastSyncedAt: new Date(), status: LinkedAccountStatus.connected },
    });
  }

  async reauth(userId: string, id: string): Promise<{ linkToken: string }> {
    const row = await this.prisma.linkedAccount.findUnique({ where: { id } });
    if (!row || row.userId !== userId) throw new NotFoundException('Linked account not found');
    const { linkToken } = await this.provider.reauth(row.providerItemId);
    return { linkToken };
  }

  async completeReauth(userId: string, id: string, publicToken: string): Promise<LinkedAccount> {
    const row = await this.prisma.linkedAccount.findUnique({ where: { id } });
    if (!row || row.userId !== userId) throw new NotFoundException('Linked account not found');
    const result = await this.provider.exchangePublicToken(publicToken, userId);
    const enc = Buffer.from(this.aes.encrypt(result.accessToken), 'base64');
    return this.prisma.linkedAccount.update({
      where: { id: row.id },
      data: {
        providerItemId: result.itemId,
        accessTokenEnc: enc,
        status: LinkedAccountStatus.connected,
        lastSyncedAt: new Date(),
      },
    });
  }

  async unlink(userId: string, id: string): Promise<void> {
    const row = await this.prisma.linkedAccount.findUnique({ where: { id } });
    if (!row || row.userId !== userId) throw new NotFoundException('Linked account not found');
    await this.prisma.linkedAccount.delete({ where: { id } });
  }
}
