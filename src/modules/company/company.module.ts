import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { BillingIntegrationModule } from '../billing-integration/billing-integration.module';
import { CompanyController } from './company.controller';
import { CompanyService } from './company.service';

@Module({
  imports: [StorageModule, BillingIntegrationModule],
  controllers: [CompanyController],
  providers: [CompanyService],
  exports: [CompanyService],
})
export class CompanyModule {}
