import { Module } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { SessionsController } from './sessions.controller';
import { SessionsRepository } from './sessions.repository';

@Module({
  providers: [SessionsService, SessionsRepository],
  controllers: [SessionsController],
  exports: [SessionsService],
})
export class SessionsModule {}
