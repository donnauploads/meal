import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TransfersService } from '../transfers/transfers.service';
import { CreateGoalDto, UpdateGoalDto } from './dto/goal.dto';

@Injectable()
export class GoalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transfers: TransfersService,
  ) {}

  list(userId: string) {
    return this.prisma.goal.findMany({
      where: { userId, archivedAt: null },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async create(userId: string, dto: CreateGoalDto) {
    if (dto.isDefault) {
      await this.prisma.goal.updateMany({ where: { userId, isDefault: true }, data: { isDefault: false } });
    }
    return this.prisma.goal.create({
      data: {
        userId,
        emoji: dto.emoji,
        name: dto.name,
        targetCents: dto.targetCents ?? null,
        targetDate: dto.targetDate ? new Date(dto.targetDate) : null,
        contributePerWeek: dto.contributePerWeek ?? null,
        isDefault: dto.isDefault ?? false,
      },
    });
  }

  async update(userId: string, id: string, dto: UpdateGoalDto) {
    const goal = await this.prisma.goal.findUnique({ where: { id } });
    if (!goal || goal.userId !== userId) throw new NotFoundException('Goal not found');
    if (dto.isDefault) {
      await this.prisma.goal.updateMany({ where: { userId, isDefault: true, id: { not: id } }, data: { isDefault: false } });
    }
    return this.prisma.goal.update({
      where: { id },
      data: {
        emoji: dto.emoji ?? undefined,
        name: dto.name ?? undefined,
        targetCents: dto.targetCents ?? undefined,
        targetDate: dto.targetDate ? new Date(dto.targetDate) : undefined,
        contributePerWeek: dto.contributePerWeek ?? undefined,
        isDefault: dto.isDefault ?? undefined,
      },
    });
  }

  async archive(userId: string, id: string) {
    const goal = await this.prisma.goal.findUnique({ where: { id } });
    if (!goal || goal.userId !== userId) throw new NotFoundException('Goal not found');
    return this.prisma.goal.update({ where: { id }, data: { archivedAt: new Date() } });
  }

  async contribute(userId: string, goalId: string, idempotencyKey: string, fromAccountId: string, amountCents: bigint) {
    const goal = await this.prisma.goal.findUnique({ where: { id: goalId } });
    if (!goal || goal.userId !== userId) throw new NotFoundException('Goal not found');
    if (goal.archivedAt) throw new BadRequestException('Goal archived');

    const savings = await this.prisma.account.findFirst({ where: { userId, type: 'savings', status: 'active' } });
    if (!savings) throw new BadRequestException('No active savings account');

    const fromAccount = await this.prisma.account.findUnique({ where: { id: fromAccountId } });
    if (!fromAccount || fromAccount.userId !== userId) throw new ForbiddenException('Not your account');

    const transfer = await this.transfers.initiate(userId, idempotencyKey, {
      fromAccountId,
      toAccountId: savings.id,
      kind: 'internal',
      amountCents,
      instant: false,
      note: `Contribute to ${goal.name}`,
    });

    const updated = await this.prisma.goal.update({
      where: { id: goalId },
      data: { currentCents: { increment: amountCents } },
    });
    return { goal: updated, transfer };
  }
}
