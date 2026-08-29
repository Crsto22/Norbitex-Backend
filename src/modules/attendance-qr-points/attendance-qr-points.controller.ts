import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { AttendanceQrPointsService } from './attendance-qr-points.service';
import { CreateAttendanceQrPointDto } from './dto/create-attendance-qr-point.dto';
import { FindAttendanceQrPointsQueryDto } from './dto/find-attendance-qr-points-query.dto';
import { UpdateAttendanceQrPointStatusDto } from './dto/update-attendance-qr-point-status.dto';
import { UpdateAttendanceQrPointDto } from './dto/update-attendance-qr-point.dto';

@UseGuards(ModuleAccessGuard)
@RequireModule('asistencias-puntos-qr')
@Controller('attendance/qr-points')
export class AttendanceQrPointsController {
  constructor(private readonly qrPointsService: AttendanceQrPointsService) {}

  @Get()
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query() query: FindAttendanceQrPointsQueryDto,
  ) {
    return this.qrPointsService.findAll(this.getEmpresaId(user), query);
  }

  @Post()
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateAttendanceQrPointDto,
  ) {
    return this.qrPointsService.create(this.getEmpresaId(user), dto);
  }

  @Get(':id/qr')
  getQr(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.qrPointsService.getQr(this.getEmpresaId(user), BigInt(id));
  }

  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.qrPointsService.findOne(this.getEmpresaId(user), BigInt(id));
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateAttendanceQrPointDto,
  ) {
    return this.qrPointsService.update(
      this.getEmpresaId(user),
      BigInt(id),
      dto,
    );
  }

  @Patch(':id/status')
  updateStatus(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateAttendanceQrPointStatusDto,
  ) {
    return this.qrPointsService.updateStatus(
      this.getEmpresaId(user),
      BigInt(id),
      dto,
    );
  }

  @Delete(':id')
  remove(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.qrPointsService.remove(this.getEmpresaId(user), BigInt(id));
  }

  private getEmpresaId(user: JwtPayload) {
    if (!user.empresaId) {
      throw new UnauthorizedException('El usuario no tiene empresa activa');
    }

    return BigInt(user.empresaId);
  }
}
