import { Module } from '@nestjs/common';
import { EnviosConfigController } from './envios-config.controller';
import { EnviosConfigService } from './envios-config.service';

@Module({
  controllers: [EnviosConfigController],
  providers: [EnviosConfigService],
  exports: [EnviosConfigService],
})
export class EnviosConfigModule {}
