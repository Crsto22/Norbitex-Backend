import { Module } from '@nestjs/common';
import { SecretsCryptoService } from '../../common/crypto/secrets-crypto.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { BillingApiClientService } from './billing-api-client.service';
import { BillingIntegrationController } from './billing-integration.controller';
import { BillingIntegrationService } from './billing-integration.service';
import { BillingEmissionService } from './billing-emission.service';
import { BillingWebhookController } from './billing-webhook.controller';
import { BillingWebhookService } from './billing-webhook.service';
import { BillingVoidService } from './billing-void.service';
import { StockModule } from '../stock/stock.module';
import { SunatEmissionModule } from '../sunat-emission/sunat-emission.module';
import { BillingCreditNoteService } from './billing-credit-note.service';
import { BillingDespatchGuideService } from './billing-despatch-guide.service';
import { BillingDebitNoteService } from './billing-debit-note.service';

@Module({
  imports: [PrismaModule, StockModule, SunatEmissionModule],
  controllers: [BillingIntegrationController, BillingWebhookController],
  providers: [
    BillingApiClientService,
    BillingIntegrationService,
    BillingEmissionService,
    BillingWebhookService,
    BillingVoidService,
    BillingCreditNoteService,
    BillingDespatchGuideService,
    BillingDebitNoteService,
    SecretsCryptoService,
  ],
  exports: [
    BillingApiClientService,
    BillingIntegrationService,
    BillingEmissionService,
    BillingVoidService,
    BillingCreditNoteService,
    BillingDespatchGuideService,
    BillingDebitNoteService,
  ],
})
export class BillingIntegrationModule {}
