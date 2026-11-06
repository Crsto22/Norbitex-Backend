import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { PlatformAdminGuard } from '../platform-admin/platform-admin.guard';
import { CourierAgenciesService } from './courier-agencies.service';
import { SyncCourierAgenciesDto } from './dto/courier-agencies.dto';

@UseGuards(PlatformAdminGuard)
@Controller('platform-admin/courier-agencies')
export class PlatformCourierAgenciesController {
  constructor(private readonly agencies: CourierAgenciesService) {}

  @Post('sync')
  sync(@Body() dto: SyncCourierAgenciesDto) {
    return dto.courier
      ? this.agencies.sync(dto.courier)
      : this.agencies.syncAll();
  }

  @Get('sync-status')
  status() {
    return this.agencies.latestSyncStatus();
  }
}
