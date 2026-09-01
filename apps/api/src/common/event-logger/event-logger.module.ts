import { Global, Module } from '@nestjs/common';
import { EventLoggerService } from './event-logger.service';
import { EventLoggerController } from './event-logger.controller';

@Global()
@Module({
  providers: [EventLoggerService],
  controllers: [EventLoggerController],
  exports: [EventLoggerService],
})
export class EventLoggerModule {}
