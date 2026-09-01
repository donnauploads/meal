import { Module } from '@nestjs/common';
import { TaxFormsService } from './tax-forms.service';
import { TaxFormsController } from './tax-forms.controller';

@Module({
  providers: [TaxFormsService],
  controllers: [TaxFormsController],
  exports: [TaxFormsService],
})
export class TaxFormsModule {}
