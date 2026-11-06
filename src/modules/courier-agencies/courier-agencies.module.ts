import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PlatformAdminGuard } from '../platform-admin/platform-admin.guard';
import { PlatformCourierAgenciesController } from './courier-agencies.controller';
import { CourierAgenciesService } from './courier-agencies.service';

@Module({
  imports: [PrismaModule],
  controllers: [PlatformCourierAgenciesController],
  providers: [CourierAgenciesService, PlatformAdminGuard],
  exports: [CourierAgenciesService],
})
export class CourierAgenciesModule {}
