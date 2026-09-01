import { Controller, Get, NotFoundException, Query, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { JwtAccessGuard } from '../../modules/auth/guards/jwt-access.guard';
import { RolesGuard } from '../../modules/auth/guards/roles.guard';
import { Roles } from '../../modules/auth/decorators/roles.decorator';
import { EventLoggerService } from './event-logger.service';

@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.admin, UserRole.superadmin)
@Controller('debug/events')
export class EventLoggerController {
  constructor(
    private readonly events: EventLoggerService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  recent(@Query('limit') limit?: string) {
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new NotFoundException();
    }
    const n = limit ? Math.max(1, Math.min(200, Number(limit))) : 50;
    return { events: this.events.recent(n) };
  }
}
