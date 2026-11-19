import { Module } from '@nestjs/common';

import { SecretsCryptoService } from '../../common/crypto/secrets-crypto.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { DocumentoConsultaModule } from '../documento-consulta/documento-consulta.module';
import { SalesModule } from '../sales/sales.module';
import { ShalomApiClientService } from './shalom-api-client.service';
import { ShalomIntegrationController } from './shalom-integration.controller';
import { ShalomIntegrationService } from './shalom-integration.service';
import { ShalomProvisioningService } from './shalom-provisioning.service';
import { ShalomRegistrationService } from './shalom-registration.service';
import { ShalomWebhookController } from './shalom-webhook.controller';
import { ShalomWebhookService } from './shalom-webhook.service';

@Module({
  imports: [PrismaModule, SalesModule, DocumentoConsultaModule],
  controllers: [ShalomIntegrationController, ShalomWebhookController],
  providers: [
    SecretsCryptoService,
    ShalomApiClientService,
    ShalomIntegrationService,
    ShalomProvisioningService,
    ShalomRegistrationService,
    ShalomWebhookService,
  ],
  exports: [
    ShalomApiClientService,
    ShalomIntegrationService,
    ShalomProvisioningService,
    ShalomRegistrationService,
  ],
})
export class ShalomIntegrationModule {}
