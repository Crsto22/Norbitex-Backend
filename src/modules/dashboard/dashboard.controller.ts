import {
  Controller,
  Get,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { getCommercialScope } from '../../common/commercial-access';
import { DashboardService } from './dashboard.service';
import { FindDashboardQueryDto } from './dto/find-dashboard-query.dto';

@UseGuards(ModuleAccessGuard)
@RequireModule('dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  find(@CurrentUser() user: JwtPayload, @Query() query: FindDashboardQueryDto) {
    return this.dashboardService.find(
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
