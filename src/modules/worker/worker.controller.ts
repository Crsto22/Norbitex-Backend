import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { RegisterWorkerDeviceDto } from './dto/register-worker-device.dto';
import { ScanAttendanceQrDto } from './dto/scan-attendance-qr.dto';
import { WorkerJwtGuard } from './guards/worker-jwt.guard';
import { WorkerService } from './worker.service';

@UseGuards(WorkerJwtGuard)
@Controller('worker')
export class WorkerController {
  constructor(private readonly workerService: WorkerService) {}

  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return this.workerService.me(BigInt(user.sub), BigInt(user.empresaId!));
  }

  @Post('device/register')
  registerDevice(
    @CurrentUser() user: JwtPayload,
    @Body() dto: RegisterWorkerDeviceDto,
  ) {
    return this.workerService.registerDevice(
      BigInt(user.sub),
      BigInt(user.empresaId!),
      dto,
    );
  }

  @Post('attendance/scan')
  scan(@CurrentUser() user: JwtPayload, @Body() dto: ScanAttendanceQrDto) {
    return this.workerService.scan(
      BigInt(user.sub),
      BigInt(user.empresaId!),
      dto,
    );
  }
}
