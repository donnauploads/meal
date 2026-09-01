import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';

export type AccessClaims = { sub: string; sid: string; role: string; jti: string };
export type RefreshClaims = { sub: string; sid: string; fam: string; jti: string };
export type MfaClaims = { sub: string; cid: string; jti: string };
export type RecoveryClaims = { sub: string; purpose: 'password_reset'; jti: string };
/** Capability token for a logged-out visitor's support thread. `tid` is the
 *  thread id; holding a valid token is proof of ownership of that thread. */
export type GuestSupportClaims = { tid: string; purpose: 'guest_support'; jti: string };

function decodeKey(b64: string | undefined): string {
  if (!b64) return '';
  try {
    return Buffer.from(b64, 'base64').toString('utf8');
  } catch {
    return b64;
  }
}

@Injectable()
export class JwtCryptoService {
  private readonly logger = new Logger(JwtCryptoService.name);
  private readonly privateKey: string;
  private readonly publicKey: string;
  private readonly accessTtl: string;
  private readonly refreshTtl: string;
  private readonly mfaTtl: string;
  private readonly recoveryTtl: string;

  constructor(private readonly config: ConfigService) {
    this.privateKey = decodeKey(config.get<string>('JWT_PRIVATE_KEY'));
    this.publicKey = decodeKey(config.get<string>('JWT_PUBLIC_KEY'));
    this.accessTtl = config.get<string>('JWT_ACCESS_TTL') ?? '15m';
    this.refreshTtl = config.get<string>('JWT_REFRESH_TTL') ?? '30d';
    this.mfaTtl = config.get<string>('JWT_MFA_TTL') ?? '5m';
    this.recoveryTtl = config.get<string>('JWT_RECOVERY_TTL') ?? '15m';
    if (!this.privateKey || !this.publicKey) {
      this.logger.warn('JWT keys not configured — generate an RS256 keypair and set JWT_PRIVATE_KEY / JWT_PUBLIC_KEY (base64-encoded PEM).');
    }
  }

  signAccess(claims: Omit<AccessClaims, 'jti'>): { token: string; jti: string } {
    const jti = randomUUID();
    const token = jwt.sign({ ...claims, jti }, this.privateKey, {
      algorithm: 'RS256',
      expiresIn: this.accessTtl,
    });
    return { token, jti };
  }

  signRefresh(claims: Omit<RefreshClaims, 'jti'>): { token: string; jti: string } {
    const jti = randomUUID();
    const token = jwt.sign({ ...claims, jti }, this.privateKey, {
      algorithm: 'RS256',
      expiresIn: this.refreshTtl,
    });
    return { token, jti };
  }

  signMfa(claims: Omit<MfaClaims, 'jti'>): string {
    return jwt.sign({ ...claims, jti: randomUUID() }, this.privateKey, {
      algorithm: 'RS256',
      expiresIn: this.mfaTtl,
    });
  }

  verifyAccess(token: string): AccessClaims {
    return jwt.verify(token, this.publicKey, { algorithms: ['RS256'] }) as AccessClaims;
  }
  verifyRefresh(token: string): RefreshClaims {
    return jwt.verify(token, this.publicKey, { algorithms: ['RS256'] }) as RefreshClaims;
  }
  verifyMfa(token: string): MfaClaims {
    return jwt.verify(token, this.publicKey, { algorithms: ['RS256'] }) as MfaClaims;
  }

  signRecovery(sub: string): string {
    return jwt.sign(
      { sub, purpose: 'password_reset', jti: randomUUID() } as RecoveryClaims,
      this.privateKey,
      { algorithm: 'RS256', expiresIn: this.recoveryTtl },
    );
  }

  verifyRecovery(token: string): RecoveryClaims {
    const claims = jwt.verify(token, this.publicKey, { algorithms: ['RS256'] }) as RecoveryClaims;
    if (claims.purpose !== 'password_reset') throw new Error('Wrong token purpose');
    return claims;
  }

  /** Long-lived capability token for a guest support thread (so the visitor
   *  can keep chatting across reloads). Bound to a single thread id. */
  signGuestSupport(threadId: string): string {
    return jwt.sign(
      { tid: threadId, purpose: 'guest_support', jti: randomUUID() } as GuestSupportClaims,
      this.privateKey,
      { algorithm: 'RS256', expiresIn: '30d' },
    );
  }

  verifyGuestSupport(token: string): GuestSupportClaims {
    const claims = jwt.verify(token, this.publicKey, { algorithms: ['RS256'] }) as GuestSupportClaims;
    if (claims.purpose !== 'guest_support') throw new Error('Wrong token purpose');
    return claims;
  }

  publicKeyPem(): string {
    return this.publicKey;
  }
}
