import { Module } from '@nestjs/common';
import { CardsService } from './cards.service';
import { CardsController } from './cards.controller';
import { CardIssuerService } from './card-issuer.service';

@Module({
  providers: [CardsService, CardIssuerService],
  controllers: [CardsController],
  exports: [CardsService],
})
export class CardsModule {}
