import { Global, Module } from '@nestjs/common';
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';

@Global()
@Module({
  controllers: [PlansController],
  providers: [PlansService, ModuleAccessGuard],
  exports: [PlansService, ModuleAccessGuard],
})
export class PlansModule {}
