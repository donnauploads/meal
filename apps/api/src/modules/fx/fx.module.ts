import { Module } from '@nestjs/common';
import { FxService } from './fx.service';
import { FxController } from './fx.controller';

@Module({
  providers: [FxService],
  controllers: [FxController],
  exports: [FxService],
})
export class FxModule {}
