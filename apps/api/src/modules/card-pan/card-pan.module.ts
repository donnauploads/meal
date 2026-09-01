import { Global, Module } from '@nestjs/common';
import { CardPanService } from './card-pan.service';

@Global()
@Module({
  providers: [CardPanService],
  exports: [CardPanService],
})
export class CardPanModule {}
