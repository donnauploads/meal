import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async lookup(key: string, userId: string, endpoint: string) {
    return this.prisma.idempotencyKey.findFirst({ where: { key, userId, endpoint } });
  }

  async store(key: string, userId: string, endpoint: string, statusCode: number, body: unknown) {
    return this.prisma.idempotencyKey.create({
      data: { key, userId, endpoint, statusCode, responseBody: body as object },
    });
  }
}
