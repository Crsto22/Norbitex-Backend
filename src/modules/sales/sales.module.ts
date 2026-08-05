import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { SunatEmissionModule } from '../sunat-emission/sunat-emission.module';
import { SalesController } from './sales.controller';
import { SalesPdfService } from './sales-pdf.service';
import { SalesService } from './sales.service';
import { SaleScopeGuard } from './guards/sale-scope.guard';
import { StockModule } from '../stock/stock.module';

@Module({
  imports: [PrismaModule, StorageModule, SunatEmissionModule, StockModule],
  controllers: [SalesController],
  providers: [SalesService, SalesPdfService, SaleScopeGuard],
  exports: [SalesService, SalesPdfService],
})
export class SalesModule {}
