import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { authenticator } from 'otplib';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AesGcmService } from '../crypto/aes-gcm.service';
import { APP_NAME } from '../../common/brand';

@Injectable()
export class TotpService {
  private readonly issuer: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly aes: AesGcmService,
    config: ConfigService,
  ) {
    this.issuer = config.get<string>('TOTP_ISSUER') ?? APP_NAME;
    authenticator.options = { window: 1 };
  }

  async begin(userId: string, accountLabel: string): Promise<{ secret: string; otpauthUrl: string }> {
    const existing = await this.prisma.totpSecret.findUnique({ where: { userId } });
    if (existing?.activatedAt) throw new BadRequestException('TOTP already active');
    const secret = authenticator.generateSecret();
    const enc = Buffer.from(this.aes.encrypt(secret), 'base64');
    await this.prisma.totpSecret.upsert({
      where: { userId },
      update: { secretEnc: enc, activatedAt: null, recoveryCodes: [] },
      create: { userId, secretEnc: enc },
    });
    const otpauthUrl = authenticator.keyuri(accountLabel, this.issuer, secret);
    return { secret, otpauthUrl };
  }

  async verify(userId: string, code: string): Promise<{ recoveryCodes: string[] }> {
    const row = await this.prisma.totpSecret.findUnique({ where: { userId } });
    if (!row) throw new NotFoundException('No TOTP pending');
    const secret = this.aes.decrypt(Buffer.from(row.secretEnc).toString('base64'));
    if (!authenticator.check(code, secret)) throw new BadRequestException('Invalid code');
    const recoveryCodes = Array.from({ length: 8 }, () => randomBytes(5).toString('hex'));
    await this.prisma.totpSecret.update({
      where: { userId },
      data: { activatedAt: row.activatedAt ?? new Date(), recoveryCodes },
    });
    return { recoveryCodes };
  }

  async disable(userId: string, currentCode: string): Promise<void> {
    const row = await this.prisma.totpSecret.findUnique({ where: { userId } });
    if (!row?.activatedAt) throw new BadRequestException('TOTP not active');
    const secret = this.aes.decrypt(Buffer.from(row.secretEnc).toString('base64'));
    if (!authenticator.check(currentCode, secret)) throw new BadRequestException('Invalid code');
    await this.prisma.totpSecret.delete({ where: { userId } });
  }

  async isActive(userId: string): Promise<boolean> {
    const row = await this.prisma.totpSecret.findUnique({ where: { userId } });
    return !!row?.activatedAt;
  }

  async verifyForLogin(userId: string, code: string): Promise<boolean> {
    const row = await this.prisma.totpSecret.findUnique({ where: { userId } });
    if (!row?.activatedAt) return false;
    const secret = this.aes.decrypt(Buffer.from(row.secretEnc).toString('base64'));
    if (authenticator.check(code, secret)) return true;
    if (row.recoveryCodes.includes(code)) {
      await this.prisma.totpSecret.update({
        where: { userId },
        data: { recoveryCodes: row.recoveryCodes.filter((c) => c !== code) },
      });
      return true;
    }
    return false;
  }
}
