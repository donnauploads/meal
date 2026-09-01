import { Injectable } from '@nestjs/common';
import { Prisma, Session } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SessionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.SessionUncheckedCreateInput, tx?: Prisma.TransactionClient): Promise<Session> {
    return (tx ?? this.prisma).session.create({ data });
  }

  findActiveByUser(userId: string, tx?: Prisma.TransactionClient) {
    return (tx ?? this.prisma).session.findMany({
      where: { userId, revokedAt: null },
      include: { device: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  findById(id: string) {
    return this.prisma.session.findUnique({ where: { id }, include: { device: true } });
  }

  findByRefreshHash(hash: string) {
    return this.prisma.session.findUnique({ where: { refreshTokenHash: hash } });
  }
}
