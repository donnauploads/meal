import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';

export const DIRECT_DEPOSIT_REQUIRED = 'auth:directDepositRequired';
export const DirectDepositActive = () => SetMetadata(DIRECT_DEPOSIT_REQUIRED, true);

@Injectable()
export class DirectDepositActiveGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean>(DIRECT_DEPOSIT_REQUIRED, [ctx.getHandler(), ctx.getClass()]);
    if (!required) return true;
    const userId = ctx.switchToHttp().getRequest().user?.sub;
    if (!userId) throw new ForbiddenException('DD_REQUIRED');
    const dd = await this.prisma.directDeposit.findUnique({ where: { userId } });
    if (!dd?.active) throw new ForbiddenException('DD_REQUIRED');
    return true;
  }
}
