import { Body, Controller, Delete, Get, HttpCode, Patch, Post, Put, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser, CurrentUserPayload } from '../auth/decorators/current-user.decorator';
import { ElevationGuard, RequiresElevation } from '../elevation/elevation.guard';
import { ProfileService } from './profile.service';
import { AvatarService } from './avatar.service';
import { UpdateProfileDto, UpdatePreferencesDto } from './dto/profile.dto';

@UseGuards(JwtAccessGuard, ElevationGuard)
@Controller('me')
export class ProfileController {
  constructor(
    private readonly profile: ProfileService,
    private readonly avatar: AvatarService,
  ) {}

  @Get()
  me(@CurrentUser() user: CurrentUserPayload) {
    return this.profile.me(user.sub);
  }

  // Profile mutations require a valid `x-elevation` token scoped to
  // `profile:edit`. The FE obtains one by calling
  // POST /me/security/transaction-pin/verify with that scope.
  @Patch()
  @RequiresElevation('profile:edit')
  update(@CurrentUser() user: CurrentUserPayload, @Body() dto: UpdateProfileDto) {
    return this.profile.update(user.sub, dto);
  }

  @Get('preferences')
  preferences(@CurrentUser() user: CurrentUserPayload) {
    return this.profile.preferences(user.sub);
  }

  @Put('preferences')
  updatePreferences(@CurrentUser() user: CurrentUserPayload, @Body() dto: UpdatePreferencesDto) {
    return this.profile.updatePreferences(user.sub, dto);
  }

  @Post('avatar')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async uploadAvatar(
    @CurrentUser() user: CurrentUserPayload,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const url = await this.avatar.upload(user.sub, file);
    return { avatarUrl: url };
  }

  @Delete('avatar')
  @HttpCode(204)
  async removeAvatar(@CurrentUser() user: CurrentUserPayload) {
    await this.avatar.remove(user.sub);
  }
}
