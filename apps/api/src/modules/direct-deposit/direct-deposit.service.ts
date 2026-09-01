import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DirectDeposit } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SWITCH_PROVIDER, SwitchProvider } from './providers/switch.provider.interface';
import { StartSwitchDto } from './dto/direct-deposit.dto';

export interface DirectDepositSummary {
  active: boolean;
  activatedAt: string | null;
  employer: { id: string; name: string } | null;
  routingNumber: string;
  accountNumberMasked: string;
  partnerRequestId: string | null;
}

@Injectable()
export class DirectDepositService {
  private readonly logger = new Logger(DirectDepositService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(SWITCH_PROVIDER) private readonly switchProvider: SwitchProvider,
  ) {}

  async summary(userId: string): Promise<DirectDepositSummary> {
    const acct = await this.prisma.account.findFirst({
      where: { userId, type: 'checking', status: 'active' },
      include: { user: true },
    });
    if (!acct) throw new BadRequestException('No active checking account');

    const dd = await this.prisma.directDeposit.findUnique({ where: { userId }, include: { employer: true } });

    return {
      active: dd?.active ?? false,
      activatedAt: dd?.activatedAt ? dd.activatedAt.toISOString() : null,
      employer: dd?.employer ? { id: dd.employer.id, name: dd.employer.name } : null,
      routingNumber: acct.mockRoutingNumber,
      accountNumberMasked: `••••${acct.mockAccountNumber.slice(-4)}`,
      partnerRequestId: dd?.partnerRequestId ?? null,
    };
  }

  async accountPlain(userId: string) {
    const acct = await this.prisma.account.findFirst({
      where: { userId, type: 'checking', status: 'active' },
      include: { user: true },
    });
    if (!acct) throw new BadRequestException('No active checking account');
    return acct;
  }

  async startSwitch(userId: string, dto: StartSwitchDto): Promise<DirectDeposit> {
    const acct = await this.accountPlain(userId);
    let employerId = dto.employerId;
    if (!employerId) {
      const employer = await this.prisma.employer.upsert({
        where: { name: dto.employerName },
        update: dto.employerDomain ? { domain: dto.employerDomain } : {},
        create: { name: dto.employerName, domain: dto.employerDomain ?? null },
      });
      employerId = employer.id;
    }

    const result = await this.switchProvider.start({
      userId,
      employerName: dto.employerName,
      employerDomain: dto.employerDomain,
      routingNumber: acct.mockRoutingNumber,
      accountNumber: acct.mockAccountNumber,
    });

    return this.prisma.directDeposit.upsert({
      where: { userId },
      update: { employerId, partnerRequestId: result.requestId },
      create: { userId, employerId, partnerRequestId: result.requestId, active: false },
    });
  }

  async handleWebhook(partnerRequestId: string): Promise<DirectDeposit> {
    const dd = await this.prisma.directDeposit.findFirst({ where: { partnerRequestId } });
    if (!dd) throw new NotFoundException('Unknown partner request');
    if (dd.active) return dd;
    return this.prisma.directDeposit.update({
      where: { userId: dd.userId },
      data: { active: true, activatedAt: new Date() },
    });
  }

  async forceActivate(userId: string): Promise<DirectDeposit> {
    return this.prisma.directDeposit.upsert({
      where: { userId },
      update: { active: true, activatedAt: new Date() },
      create: { userId, active: true, activatedAt: new Date() },
    });
  }
}
