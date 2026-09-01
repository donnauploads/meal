import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DealsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const now = new Date();
    const [deals, activations] = await Promise.all([
      this.prisma.deal.findMany({
        where: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        include: { merchant: true },
        orderBy: { cashbackBps: 'desc' },
      }),
      this.prisma.activatedDeal.findMany({ where: { userId } }),
    ]);
    const byDealId = new Map(activations.map((a) => [a.dealId, a]));
    return deals.map((d) => ({
      id: d.id,
      title: d.title,
      description: d.description,
      cashbackBps: d.cashbackBps,
      expiresAt: d.expiresAt ? d.expiresAt.toISOString() : null,
      imageUrl: d.imageUrl,
      merchant: d.merchant ? { id: d.merchant.id, name: d.merchant.name, logoUrl: d.merchant.logoUrl } : null,
      activated: byDealId.has(d.id),
      redeemed: !!byDealId.get(d.id)?.redeemedAt,
    }));
  }

  async activate(userId: string, dealId: string) {
    const deal = await this.prisma.deal.findUnique({ where: { id: dealId } });
    if (!deal) throw new NotFoundException('Deal not found');
    if (deal.expiresAt && deal.expiresAt < new Date()) throw new ConflictException('Deal expired');
    try {
      return await this.prisma.activatedDeal.create({ data: { userId, dealId } });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        return this.prisma.activatedDeal.findUniqueOrThrow({ where: { userId_dealId: { userId, dealId } } });
      }
      throw err;
    }
  }
}
