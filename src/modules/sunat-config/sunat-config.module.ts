import { Module } from '@nestjs/common';
import { SecretsCryptoService } from '../../common/crypto/secrets-crypto.service';
import { StorageModule } from '../storage/storage.module';
import { SunatConfigController } from './sunat-config.controller';
import { SunatConfigService } from './sunat-config.service';
import { SunatEndpointConfigService } from './sunat-endpoint-config.service';

@Module({
  imports: [StorageModule],
  controllers: [SunatConfigController],
  providers: [
    SunatConfigService,
    SunatEndpointConfigService,
    SecretsCryptoService,
  ],
  exports: [SunatConfigService, SunatEndpointConfigService],
})
export class SunatConfigModule {}
