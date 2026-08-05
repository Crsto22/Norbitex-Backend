import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { PlatformAdminGuard } from '../platform-admin/platform-admin.guard';
import {
  FindManualNotificationsQueryDto,
  FindNotificationUsersQueryDto,
  PublishNotificationDto,
} from './dto/notifications.dto';
import { NotificationsService } from './notifications.service';

@UseGuards(PlatformAdminGuard)
@Controller('platform-admin/notifications')
export class PlatformNotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  findManual(@Query() query: FindManualNotificationsQueryDto) {
    return this.notifications.findManual(query);
  }

  @Get('users')
  findUsers(@Query() query: FindNotificationUsersQueryDto) {
    return this.notifications.findCompanyUsers(query);
  }

  @Post()
  publish(
    @CurrentUser() user: JwtPayload,
    @Body() dto: PublishNotificationDto,
  ) {
    return this.notifications.publish(user, dto);
  }

  @Post(':id/archive')
  archive(@Param('id') id: string) {
    return this.notifications.archive(id);
  }
}
