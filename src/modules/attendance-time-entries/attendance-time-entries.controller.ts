import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { AttendanceTimeEntriesService } from './attendance-time-entries.service';
import { CreateManualAttendanceTimeEntryDto } from './dto/create-manual-attendance-time-entry.dto';
import { FindAttendanceTimeEntryHistoryQueryDto } from './dto/find-attendance-time-entry-history-query.dto';
import { FindAttendanceTimeEntriesQueryDto } from './dto/find-attendance-time-entries-query.dto';

@UseGuards(ModuleAccessGuard)
@RequireModule('asistencias-marcajes')
@Controller('attendance/time-entries')
export class AttendanceTimeEntriesController {
  constructor(
    private readonly timeEntriesService: AttendanceTimeEntriesService,
  ) {}

  @Get()
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query() query: FindAttendanceTimeEntriesQueryDto,
  ) {
    return this.timeEntriesService.findAll(this.getEmpresaId(user), query);
  }

  @Get('history')
  @RequireModule('asistencias-historial-marcaciones')
  findHistory(
    @CurrentUser() user: JwtPayload,
    @Query() query: FindAttendanceTimeEntryHistoryQueryDto,
  ) {
    return this.timeEntriesService.findHistory(this.getEmpresaId(user), query);
  }

  @Post('manual')
  createManual(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateManualAttendanceTimeEntryDto,
  ) {
    return this.timeEntriesService.createManual(this.getEmpresaId(user), dto);
  }

  private getEmpresaId(user: JwtPayload) {
    if (!user.empresaId) {
      throw new UnauthorizedException('El usuario no tiene empresa activa');
    }

    return BigInt(user.empresaId);
  }
}
