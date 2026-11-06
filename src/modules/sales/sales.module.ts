import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { SunatEmissionModule } from '../sunat-emission/sunat-emission.module';
import { SalesController } from './sales.controller';
import { SalesPdfService } from './sales-pdf.service';
import { SalesService } from './sales.service';
import { SaleScopeGuard } from './guards/sale-scope.guard';
import { StockModule } from '../stock/stock.module';
import { BillingIntegrationModule } from '../billing-integration/billing-integration.module';
import { PublicShippingLinksController } from './public-shipping-links.controller';
import { ShippingLinksService } from './shipping-links.service';
import { CourierAgenciesModule } from '../courier-agencies/courier-agencies.module';

@Module({
  imports: [
    PrismaModule,
    StorageModule,
    SunatEmissionModule,
    StockModule,
    BillingIntegrationModule,
    CourierAgenciesModule,
  ],
  controllers: [SalesController, PublicShippingLinksController],
  providers: [
    SalesService,
    SalesPdfService,
    SaleScopeGuard,
    ShippingLinksService,
  ],
  exports: [SalesService, SalesPdfService],
})
export class SalesModule {}
