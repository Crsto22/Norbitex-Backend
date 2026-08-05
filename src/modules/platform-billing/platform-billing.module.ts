import { Module } from '@nestjs/common';
import { SecretsCryptoService } from '../../common/crypto/secrets-crypto.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { PlatformAdminGuard } from '../platform-admin/platform-admin.guard';
import {
  CompanyBillingController,
  PlatformBillingAdminController,
} from './platform-billing.controller';
import { PlatformBillingService } from './platform-billing.service';
import { PlatformBillingSunatService } from './platform-billing-sunat.service';
import { SunatEmissionModule } from '../sunat-emission/sunat-emission.module';
import { SunatConfigModule } from '../sunat-config/sunat-config.module';
import { MailModule } from '../mail/mail.module';
import { SalesModule } from '../sales/sales.module';

@Module({
  imports: [
    PrismaModule,
    StorageModule,
    SunatEmissionModule,
    SunatConfigModule,
    MailModule,
    SalesModule,
  ],
  controllers: [PlatformBillingAdminController, CompanyBillingController],
  providers: [
    PlatformBillingService,
    PlatformBillingSunatService,
    PlatformAdminGuard,
    SecretsCryptoService,
  ],
  exports: [PlatformBillingService],
})
export class PlatformBillingModule {}
