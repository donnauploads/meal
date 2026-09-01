import { Controller, Get, Headers, Query, UseGuards } from '@nestjs/common';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { GreetingService } from './greeting.service';

@UseGuards(JwtAccessGuard)
@Controller('me')
export class GreetingController {
  constructor(private readonly greeting: GreetingService) {}

  @Get('greeting')
  async get(
    @CurrentUser() user: CurrentUserPayload,
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
    @Headers('x-timezone') xTimezone?: string,
  ) {
    const latN = lat != null && !Number.isNaN(Number(lat)) ? Number(lat) : undefined;
    const lngN = lng != null && !Number.isNaN(Number(lng)) ? Number(lng) : undefined;
    return this.greeting.getForUser(user.sub, latN, lngN, xTimezone);
  }
}
