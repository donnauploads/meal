import { Module } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { AccountsController } from './accounts.controller';
import { AccountsRepository } from './accounts.repository';
import { AccountProvisionerService } from './account-provisioner.service';

@Module({
  providers: [AccountsService, AccountsRepository, AccountProvisionerService],
  controllers: [AccountsController],
  exports: [AccountsService],
})
export class AccountsModule {}
