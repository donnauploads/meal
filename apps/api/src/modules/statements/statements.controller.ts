import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { StatementsService } from './statements.service';
import { CustomStatementDto } from './dto/custom-statement.dto';

@UseGuards(JwtAccessGuard)
@Controller('statements')
export class StatementsController {
  constructor(private readonly statements: StatementsService) {}

  @Get()
  list(@CurrentUser() user: CurrentUserPayload) {
    return this.statements.listForUser(user.sub);
  }

  @Get(':id/download')
  async download(@CurrentUser() user: CurrentUserPayload, @Param('id', ParseUUIDPipe) id: string) {
    const url = await this.statements.downloadUrl(user.sub, id);
    return { url };
  }

  /**
   * On-demand statement for a user-picked period. Streams the PDF directly
   * back so the browser triggers a download without an intermediate storage
   * round-trip.
   */
  @Post('custom')
  @Header('Content-Type', 'application/pdf')
  async customDownload(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: CustomStatementDto,
    @Res() res: Response,
  ) {
    const { pdf, filename } = await this.statements.renderCustom(
      user.sub,
      dto.accountId,
      dto.periodStart,
      dto.periodEnd,
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdf.length.toString());
    res.send(pdf);
  }
}
