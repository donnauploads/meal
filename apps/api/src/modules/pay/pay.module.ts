import { Module } from '@nestjs/common';
import { PayService } from './pay.service';
import { PayController } from './pay.controller';
import { TransfersModule } from '../transfers/transfers.module';
import { ContactsModule } from '../contacts/contacts.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [TransfersModule, ContactsModule, NotificationsModule],
  providers: [PayService],
  controllers: [PayController],
  exports: [PayService],
})
export class PayModule {}
