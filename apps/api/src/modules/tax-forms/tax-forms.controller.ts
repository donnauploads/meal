import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { TaxFormsService } from './tax-forms.service';

@UseGuards(JwtAccessGuard)
@Controller('tax-forms')
export class TaxFormsController {
  constructor(private readonly tax: TaxFormsService) {}

  @Get()
  list(@CurrentUser() user: CurrentUserPayload) {
    return this.tax.listForUser(user.sub);
  }

  @Get(':id/download')
  async download(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    const url = await this.tax.downloadUrl(user.sub, id);
    return { url };
  }
}
