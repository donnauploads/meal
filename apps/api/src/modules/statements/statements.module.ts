import { Module } from '@nestjs/common';
import { StatementsService } from './statements.service';
import { StatementsController } from './statements.controller';
import { StatementRenderer } from './statement.renderer';

@Module({
  providers: [StatementsService, StatementRenderer],
  controllers: [StatementsController],
  exports: [StatementsService],
})
export class StatementsModule {}
