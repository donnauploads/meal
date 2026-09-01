import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { Public } from '../decorators/public.decorator';
import { SignupService } from './signup.service';
import { DocumentsService } from '../../documents/documents.service';
import { BeginSignupDto } from './dto/begin-signup.dto';
import { DobDto, CardChoiceDto, AddressDto, PasswordDto, DetailsDto, SsnDto } from './dto/step.dto';
import { UploadDocumentDto } from './dto/upload-document.dto';

function readIp(req: Request): string {
  const xff = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
  return xff || req.ip || req.socket.remoteAddress || '0.0.0.0';
}

@Public()
@Controller('auth/signup')
export class SignupController {
  constructor(
    private readonly signup: SignupService,
    private readonly documents: DocumentsService,
  ) {}

  @Post('begin')
  @HttpCode(201)
  async begin(@Body() dto: BeginSignupDto) {
    const s = await this.signup.begin(dto);
    return { signupId: s.id, stage: s.stage };
  }

  @Post(':id/dob')
  @HttpCode(200)
  async dob(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DobDto) {
    const s = await this.signup.load(id);
    await this.signup.setDob(s, dto.dob);
    return { ok: true };
  }

  @Post(':id/card')
  @HttpCode(200)
  async card(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CardChoiceDto) {
    const s = await this.signup.load(id);
    await this.signup.setCard(s, dto.cardChoice);
    return { ok: true };
  }

  @Post(':id/address')
  @HttpCode(200)
  async address(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AddressDto) {
    const s = await this.signup.load(id);
    await this.signup.setAddress(s, dto);
    return { ok: true };
  }

  @Post(':id/password')
  @HttpCode(200)
  async password(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PasswordDto) {
    const s = await this.signup.load(id);
    await this.signup.setPassword(s, dto.password);
    return { ok: true };
  }

  @Post(':id/details')
  @HttpCode(200)
  async details(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DetailsDto) {
    const s = await this.signup.load(id);
    await this.signup.setDetails(s, dto);
    return { ok: true };
  }

  @Post(':id/ssn')
  @HttpCode(200)
  async ssn(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SsnDto) {
    const s = await this.signup.load(id);
    await this.signup.setSsn(s, dto.ssn);
    return { ok: true };
  }

  @Post(':id/documents')
  @HttpCode(201)
  // 25 MB is well above what stock phone cameras produce for KYC photos
  // (typically 3–8 MB) while still bounding pathological payloads. multer
  // will reject anything larger with its own 413 before the request hits
  // the service.
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }))
  async uploadDoc(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const s = await this.signup.load(id);
    if (!file) return { ok: false, error: 'no file' };
    const doc = await this.documents.upload({
      type: dto.type,
      subtype: dto.subtype,
      contentType: file.mimetype,
      body: file.buffer,
      ownerSignupId: s.id,
    });
    return { id: doc.id, type: doc.type, status: doc.status };
  }

  @Post(':id/documents/done')
  @HttpCode(200)
  async docsDone(@Param('id', ParseUUIDPipe) id: string) {
    const s = await this.signup.load(id);
    await this.signup.markDocsSubmitted(s);
    return { ok: true };
  }

  @Post(':id/complete')
  @HttpCode(201)
  async complete(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    const s = await this.signup.load(id);
    const result = await this.signup.complete(s, readIp(req));
    return { ok: true, userId: result.userId };
  }
}
