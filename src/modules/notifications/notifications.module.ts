import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PlansModule } from '../plans/plans.module';
import { PlatformAdminGuard } from '../platform-admin/platform-admin.guard';
import { NotificationsController } from './notifications.controller';
import { NotificationsProcessor } from './notifications.processor';
import { NotificationsService } from './notifications.service';
import { PlatformNotificationsController } from './platform-notifications.controller';

@Module({
  imports: [PrismaModule, PlansModule],
  controllers: [NotificationsController, PlatformNotificationsController],
  providers: [NotificationsService, NotificationsProcessor, PlatformAdminGuard],
  exports: [NotificationsService],
})
export class NotificationsModule {}
