import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SalesModule } from '../sales/sales.module';
import { StorageModule } from '../storage/storage.module';
import { QuotationsController } from './quotations.controller';
import { QuotationsPdfService } from './quotations-pdf.service';
import { QuotationsService } from './quotations.service';

@Module({
  imports: [PrismaModule, SalesModule, StorageModule],
  controllers: [QuotationsController],
  providers: [QuotationsService, QuotationsPdfService],
})
export class QuotationsModule {}
