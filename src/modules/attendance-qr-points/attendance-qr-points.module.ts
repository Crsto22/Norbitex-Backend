import { Module } from '@nestjs/common';
import { AttendanceQrPointsController } from './attendance-qr-points.controller';
import { AttendanceQrPointsService } from './attendance-qr-points.service';

@Module({
  controllers: [AttendanceQrPointsController],
  providers: [AttendanceQrPointsService],
})
export class AttendanceQrPointsModule {}
