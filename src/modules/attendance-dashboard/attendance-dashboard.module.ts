import { Module } from '@nestjs/common';
import { ResponseCacheModule } from '../../common/cache/response-cache.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { AttendanceDashboardController } from './attendance-dashboard.controller';
import { AttendanceDashboardService } from './attendance-dashboard.service';

@Module({
  imports: [PrismaModule, ResponseCacheModule],
  controllers: [AttendanceDashboardController],
  providers: [AttendanceDashboardService],
})
export class AttendanceDashboardModule {}
