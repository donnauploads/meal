import { Module } from '@nestjs/common';
import { ProfileService } from './profile.service';
import { ProfileController } from './profile.controller';
import { AvatarService } from './avatar.service';
import { ElevationModule } from '../elevation/elevation.module';

@Module({
  imports: [ElevationModule],
  providers: [ProfileService, AvatarService],
  controllers: [ProfileController],
  exports: [ProfileService],
})
export class ProfileModule {}
