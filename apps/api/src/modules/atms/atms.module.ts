import { Module } from '@nestjs/common';
import { AtmsController } from './atms.controller';
import { AtmsService } from './atms.service';

@Module({
  controllers: [AtmsController],
  providers: [AtmsService],
})
export class AtmsModule {}
