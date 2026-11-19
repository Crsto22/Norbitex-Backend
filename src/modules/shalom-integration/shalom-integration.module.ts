import { Module } from '@nestjs/common';

import { SecretsCryptoService } from '../../common/crypto/secrets-crypto.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { ShalomApiClientService } from './shalom-api-client.service';
import { ShalomIntegrationController } from './shalom-integration.controller';
import { ShalomIntegrationService } from './shalom-integration.service';
import { ShalomRegistrationService } from './shalom-registration.service';
import { ShalomWebhookController } from './shalom-webhook.controller';
import { ShalomWebhookService } from './shalom-webhook.service';

@Module({
  imports: [PrismaModule],
  controllers: [ShalomIntegrationController, ShalomWebhookController],
  providers: [
    SecretsCryptoService,
    ShalomApiClientService,
    ShalomIntegrationService,
    ShalomRegistrationService,
    ShalomWebhookService,
  ],
  exports: [
    ShalomApiClientService,
    ShalomIntegrationService,
    ShalomRegistrationService,
  ],
})
export class ShalomIntegrationModule {}
