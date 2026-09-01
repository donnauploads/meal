import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateProfileDto, UpdatePreferencesDto } from './dto/profile.dto';

@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    // securitySetupRequired isn't in the generated Prisma client yet (same
    // raw-SQL pattern as transfersDisabled / transactionPinHash).
    const flagRows = await this.prisma.$queryRaw<{ securitySetupRequired: boolean }[]>`
      SELECT "securitySetupRequired" FROM "User" WHERE "id" = ${userId}::uuid LIMIT 1
    `;
    return {
      id: user.id,
      email: user.email,
      phoneE164: user.phoneE164,
      novaTag: user.novaTag,
      firstName: user.firstName,
      lastName: user.lastName,
      dob: user.dob ? user.dob.toISOString().slice(0, 10) : null,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
      role: user.role,
      status: user.status,
      securitySetupRequired: !!flagRows[0]?.securitySetupRequired,
    };
  }

  async update(userId: string, dto: UpdateProfileDto) {
    if (dto.novaTag) {
      const taken = await this.prisma.user.findFirst({
        where: { novaTag: dto.novaTag, NOT: { id: userId } },
        select: { id: true },
      });
      if (taken) throw new BadRequestException('novaTag already taken');
    }
    if (dto.phoneE164) {
      const taken = await this.prisma.user.findFirst({
        where: { phoneE164: dto.phoneE164, NOT: { id: userId } },
        select: { id: true },
      });
      if (taken) throw new BadRequestException('phone number already in use');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        firstName: dto.firstName ?? undefined,
        lastName: dto.lastName ?? undefined,
        novaTag: dto.novaTag ?? undefined,
        bio: dto.bio ?? undefined,
        phoneE164: dto.phoneE164 ?? undefined,
      },
    });
    return this.me(userId);
  }

  async preferences(userId: string) {
    return this.prisma.userPreference.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
  }

  async updatePreferences(userId: string, dto: UpdatePreferencesDto) {
    return this.prisma.userPreference.upsert({
      where: { userId },
      update: {
        theme: dto.theme ?? undefined,
        doNotSell: dto.doNotSell ?? undefined,
        marketingData: dto.marketingData ?? undefined,
        analytics: dto.analytics ?? undefined,
        shareContacts: dto.shareContacts ?? undefined,
      },
      create: {
        userId,
        theme: dto.theme ?? 'system',
        doNotSell: dto.doNotSell ?? false,
        marketingData: dto.marketingData ?? true,
        analytics: dto.analytics ?? true,
        shareContacts: dto.shareContacts ?? false,
      },
    });
  }
}
