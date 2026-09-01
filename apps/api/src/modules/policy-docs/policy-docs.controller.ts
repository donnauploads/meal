import { Controller, Get, Header, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { PolicyDocsService } from './policy-docs.service';

@Public()
@Controller('policies')
export class PolicyDocsController {
  constructor(private readonly svc: PolicyDocsService) {}

  @Get()
  list() {
    return this.svc.listLatest();
  }

  @Get(':slug')
  one(@Param('slug') slug: string) {
    return this.svc.getLatestBySlug(slug);
  }

  @Get(':slug/versions')
  versions(@Param('slug') slug: string) {
    return this.svc.versionsForSlug(slug);
  }

  @Get(':slug/pdf')
  @Header('Content-Type', 'application/pdf')
  async pdf(@Param('slug') slug: string, @Res() res: Response) {
    const { pdf, filename } = await this.svc.renderPdf(slug);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdf.length.toString());
    res.send(pdf);
  }
}
