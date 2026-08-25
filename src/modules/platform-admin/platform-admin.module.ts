import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PlansModule } from '../plans/plans.module';
import { PlatformAdminController } from './platform-admin.controller';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformAdminService } from './platform-admin.service';
import { PlatformSubscriptionsService } from './platform-subscriptions.service';
import { PlatformOveragesService } from './platform-overages.service';
import { PlatformBillingModule } from '../platform-billing/platform-billing.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SunatConfigModule } from '../sunat-config/sunat-config.module';
import { PlatformSunatController } from './platform-sunat.controller';
import { PlatformSunatService } from './platform-sunat.service';

@Module({
  imports: [
    PrismaModule,
    PlansModule,
    PlatformBillingModule,
    NotificationsModule,
    SunatConfigModule,
  ],
  controllers: [PlatformAdminController, PlatformSunatController],
  providers: [
    PlatformAdminService,
    PlatformSubscriptionsService,
    PlatformAdminGuard,
    PlatformOveragesService,
    PlatformSunatService,
  ],
})
export class PlatformAdminModule {}
