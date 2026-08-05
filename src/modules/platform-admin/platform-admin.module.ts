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
import { PlatformAffiliatesService } from './platform-affiliates.service';

@Module({
  imports: [
    PrismaModule,
    PlansModule,
    PlatformBillingModule,
    NotificationsModule,
  ],
  controllers: [PlatformAdminController],
  providers: [
    PlatformAdminService,
    PlatformSubscriptionsService,
    PlatformAdminGuard,
    PlatformOveragesService,
    PlatformAffiliatesService,
  ],
})
export class PlatformAdminModule {}
