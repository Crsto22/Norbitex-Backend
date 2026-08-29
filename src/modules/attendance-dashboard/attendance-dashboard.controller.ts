import {
  Controller,
  Get,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import { rateLimits } from '../../common/rate-limits';
import { getCommercialScope } from '../../common/commercial-access';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { AttendanceDashboardService } from './attendance-dashboard.service';
import { FindAttendanceDashboardQueryDto } from './dto/find-attendance-dashboard-query.dto';

@UseGuards(ModuleAccessGuard)
@RequireModule('asistencias-dashboard')
@Throttle(rateLimits.dashboard)
@Controller('attendance/dashboard')
export class AttendanceDashboardController {
  constructor(
    private readonly attendanceDashboardService: AttendanceDashboardService,
  ) {}

  @Get()
  find(
    @CurrentUser() user: JwtPayload,
    @Query() query: FindAttendanceDashboardQueryDto,
  ) {
    return this.attendanceDashboardService.find(
      this.getEmpresaId(user),
      getCommercialScope(user),
      query,
    );
  }

  private getEmpresaId(user: JwtPayload) {
    if (!user.empresaId) {
      throw new UnauthorizedException('El usuario no tiene empresa activa');
    }

    return BigInt(user.empresaId);
  }
}
