import { Global, Module } from '@nestjs/common';
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import { PlatformAffiliatesService } from '../platform-admin/platform-affiliates.service';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';

@Global()
@Module({
  controllers: [PlansController],
  providers: [PlansService, ModuleAccessGuard, PlatformAffiliatesService],
  exports: [PlansService, ModuleAccessGuard, PlatformAffiliatesService],
})
export class PlansModule {}
