import { Global, Module } from '@nestjs/common';
import { PdfConcurrencyService } from './pdf-concurrency.service';

@Global()
@Module({
  providers: [PdfConcurrencyService],
  exports: [PdfConcurrencyService],
})
export class PdfConcurrencyModule {}
