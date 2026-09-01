import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TotpService } from './totp.service';

@Injectable()
export class MeSecurityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly totp: TotpService,
  ) {}

  async overview(userId: string) {
    const [user, sessions, devices, totpActive, biometric] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, phoneE164: true, updatedAt: true } }),
      this.prisma.session.count({ where: { userId, revokedAt: null } }),
      this.prisma.device.count({ where: { userId, revokedAt: null } }),
      this.totp.isActive(userId),
      // Only ACTIVE enrollments count as "enrolled". Disabling biometric is a
      // soft-delete (stamps disabledAt, keeps the row for reactivate()), so a
      // bare count would report the toggle as still on after it was turned off.
      // Mirrors BiometricService.list()'s `disabledAt: null` filter.
      this.prisma.biometricEnrollment.count({ where: { userId, disabledAt: null } }),
    ]);
    return {
      email: user?.email ?? null,
      phoneE164: user?.phoneE164 ?? null,
      activeSessions: sessions,
      knownDevices: devices,
      totpActive,
      biometricEnrolled: biometric > 0,
      passwordUpdatedAt: user?.updatedAt?.toISOString() ?? null,
    };
  }
}
