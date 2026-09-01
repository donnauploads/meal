import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { JwtCryptoService, RefreshClaims } from '../../crypto/jwt.service';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(jwt: JwtCryptoService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) => req?.cookies?.refresh_token || null,
        (req: Request) => (req?.body && (req.body as { refreshToken?: string }).refreshToken) || null,
      ]),
      ignoreExpiration: false,
      secretOrKey: jwt.publicKeyPem() || 'invalid',
      algorithms: ['RS256'],
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: RefreshClaims) {
    const token =
      req?.cookies?.refresh_token ||
      (req?.body && (req.body as { refreshToken?: string }).refreshToken);
    return { ...payload, token };
  }
}
