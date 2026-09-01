import { Module } from '@nestjs/common';
import { AdminTransactionsService } from './admin-transactions.service';
import { AdminTransactionsController } from './admin-transactions.controller';
import { AdminTransactionsRepository } from './admin-transactions.repository';

@Module({
  providers: [AdminTransactionsService, AdminTransactionsRepository],
  controllers: [AdminTransactionsController],
  exports: [AdminTransactionsService],
})
export class AdminTransactionsModule {}
