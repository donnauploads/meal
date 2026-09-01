import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export interface CurrentUserPayload {
  sub: string;
  sid: string;
  role: UserRole;
}

export const CurrentUser = createParamDecorator((_d, ctx: ExecutionContext): CurrentUserPayload => {
  const req = ctx.switchToHttp().getRequest();
  return req.user as CurrentUserPayload;
});
