import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { Argon2Service } from '../crypto/argon2.service';
import { JwtCryptoService } from '../crypto/jwt.service';
import { MfaService } from '../mfa/mfa.service';
import { PrismaService } from '../../prisma/prisma.service';

export type ElevationScope =
  | 'card:reveal'
  | 'wire:create'
  | 'transfer:authorize'
  | 'profile:edit'
  | 'security:manage';

export interface ElevationClaims {
  sub: string;
  scope: ElevationScope;
  jti: string;
  purpose: 'elevation';
}

@Injectable()
export class ElevationService {
  private readonly ttl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mfa: MfaService,
    private readonly argon: Argon2Service,
    private readonly jwt: JwtCryptoService,
    config: ConfigService,
  ) {
    this.ttl = config.get<string>('JWT_ELEVATION_TTL') ?? '5m';
  }

  async beginChallenge(userId: string, scope: ElevationScope, deviceContext: {
    fingerprint: string; name: string; os: string; browser: string; ip: string;
  }) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('User not found');
    const challenge = await this.mfa.createSmsChallenge(userId, user.phoneE164, deviceContext);
    return { challengeId: challenge.id, scope };
  }

  async verifyChallenge(userId: string, challengeId: string, code: string, scope: ElevationScope): Promise<string> {
    await this.mfa.verify(challengeId, code);
    return this.signElevation(userId, scope);
  }

  /**
   * Issue an elevation token without going through SMS. Used by the PIN
   * and biometric verification paths — those have already proven the
   * factor by the time they reach this method.
   */
  signElevation(userId: string, scope: ElevationScope): string {
    return (jwt as unknown as { sign: typeof jwt.sign }).sign(
      { sub: userId, scope, jti: randomUUID(), purpose: 'elevation' } as ElevationClaims,
      this.privateKey(),
      { algorithm: 'RS256', expiresIn: this.ttl },
    );
  }

  verifyToken(token: string, requiredScope: ElevationScope): ElevationClaims {
    let claims: ElevationClaims;
    try {
      claims = (jwt as unknown as { verify: typeof jwt.verify }).verify(token, this.publicKey(), {
        algorithms: ['RS256'],
      }) as ElevationClaims;
    } catch {
      throw new UnauthorizedException('Invalid elevation token');
    }
    if (claims.purpose !== 'elevation') throw new UnauthorizedException('Wrong token purpose');
    if (claims.scope !== requiredScope) throw new UnauthorizedException('Elevation scope mismatch');
    return claims;
  }

  private privateKey(): string {
    return (this.jwt as unknown as { privateKey: string }).privateKey ?? '';
  }
  private publicKey(): string {
    return this.jwt.publicKeyPem();
  }
}
