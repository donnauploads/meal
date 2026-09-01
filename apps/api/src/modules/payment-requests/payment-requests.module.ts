import { Module } from '@nestjs/common';
import { PaymentRequestsService } from './payment-requests.service';
import { PaymentRequestsController } from './payment-requests.controller';
import { PayModule } from '../pay/pay.module';
import { TransfersModule } from '../transfers/transfers.module';

@Module({
  imports: [PayModule, TransfersModule],
  providers: [PaymentRequestsService],
  controllers: [PaymentRequestsController],
  exports: [PaymentRequestsService],
})
export class PaymentRequestsModule {}
