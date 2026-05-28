import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { SalesController } from './sales.controller';
import { SalesPdfService } from './sales-pdf.service';
import { SalesService } from './sales.service';

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [SalesController],
  providers: [SalesService, SalesPdfService],
  exports: [SalesService],
})
export class SalesModule {}
