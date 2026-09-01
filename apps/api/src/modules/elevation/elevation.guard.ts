import { CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ElevationScope, ElevationService } from './elevation.service';

export const ELEVATION_SCOPE = 'auth:elevationScope';
export const RequiresElevation = (scope: ElevationScope) => SetMetadata(ELEVATION_SCOPE, scope);

@Injectable()
export class ElevationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly elevation: ElevationService,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const scope = this.reflector.getAllAndOverride<ElevationScope>(ELEVATION_SCOPE, [ctx.getHandler(), ctx.getClass()]);
    if (!scope) return true;
    const req = ctx.switchToHttp().getRequest();
    const token = req.headers['x-elevation'];
    if (!token || typeof token !== 'string') throw new UnauthorizedException('Elevation required');
    const claims = this.elevation.verifyToken(token, scope);
    const userId = req.user?.sub;
    if (claims.sub !== userId) throw new UnauthorizedException('Elevation does not match user');
    return true;
  }
}
