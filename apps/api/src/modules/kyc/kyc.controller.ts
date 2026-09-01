import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { KycService } from './kyc.service';
import { DocumentsService } from '../documents/documents.service';
import { UploadDocumentDto } from '../auth/signup/dto/upload-document.dto';
import { RejectKycDto } from './dto/kyc.dto';

@UseGuards(JwtAccessGuard, RolesGuard)
@Controller('kyc')
export class KycController {
  constructor(
    private readonly kyc: KycService,
    private readonly documents: DocumentsService,
  ) {}

  @Get('me')
  async myStatus(@CurrentUser() user: CurrentUserPayload) {
    return this.kyc.statusForUser(user.sub);
  }

  @Post('documents')
  @HttpCode(201)
  // Aligned with the signup upload limit so re-uploads after sign-in
  // don't suddenly start rejecting phone photos that the original signup
  // step accepted.
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }))
  async uploadDocument(
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const doc = await this.documents.upload({
      type: dto.type,
      subtype: dto.subtype,
      contentType: file.mimetype,
      body: file.buffer,
      ownerUserId: user.sub,
    });
    return { id: doc.id, type: doc.type, status: doc.status };
  }

  @Get('queue')
  @Roles(UserRole.admin, UserRole.superadmin)
  async queue(@Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    return this.kyc.listPending(limit ? Number(limit) : 50, cursor);
  }

  @Post(':id/approve')
  @Roles(UserRole.admin, UserRole.superadmin)
  @HttpCode(200)
  async approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: CurrentUserPayload) {
    return this.kyc.approve(id, user.sub);
  }

  @Post(':id/reject')
  @Roles(UserRole.admin, UserRole.superadmin)
  @HttpCode(200)
  async reject(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserPayload,
    @Body() dto: RejectKycDto,
  ) {
    return this.kyc.reject(id, user.sub, dto.reason, dto.missingFields);
  }
}
