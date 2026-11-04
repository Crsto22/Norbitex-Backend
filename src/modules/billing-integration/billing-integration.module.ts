import { Module } from '@nestjs/common';
import { SecretsCryptoService } from '../../common/crypto/secrets-crypto.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { BillingApiClientService } from './billing-api-client.service';
import { BillingIntegrationController } from './billing-integration.controller';
import { BillingIntegrationService } from './billing-integration.service';
import { BillingEmissionService } from './billing-emission.service';
import { BillingWebhookController } from './billing-webhook.controller';
import { BillingWebhookService } from './billing-webhook.service';

@Module({
  imports: [PrismaModule],
  controllers: [BillingIntegrationController, BillingWebhookController],
  providers: [
    BillingApiClientService,
    BillingIntegrationService,
    BillingEmissionService,
    BillingWebhookService,
    SecretsCryptoService,
  ],
  exports: [
    BillingApiClientService,
    BillingIntegrationService,
    BillingEmissionService,
  ],
})
export class BillingIntegrationModule {}
