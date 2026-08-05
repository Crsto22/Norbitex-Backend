import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { StockModule } from '../stock/stock.module';

@Module({
  imports: [StorageModule, StockModule],
  controllers: [ProductsController],
  providers: [ProductsService],
})
export class ProductsModule {}
