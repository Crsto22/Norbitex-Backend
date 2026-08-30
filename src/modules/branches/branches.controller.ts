import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
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
import { getCommercialScope } from '../../common/commercial-access';
import { BranchesService } from './branches.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { FindBranchesQueryDto } from './dto/find-branches-query.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

@UseGuards(ModuleAccessGuard)
@Controller('branches')
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) {}

  @Get()
  @RequireModule(
    'dashboard',
    'ventas-pos',
    'caja',
    'cotizaciones',
    'productos',
    'sucursales',
    'gre-remitente',
    'reportes-ventas',
    'reportes-productos',
    'reportes-clientes',
    'reportes-usuarios',
    'stock-movimientos',
    'stock-traspasos',
    'stock-kardex',
    'asistencias-dashboard',
    'asistencias-configuracion',
    'asistencias-marcajes',
    'asistencias-historial-marcaciones',
    'asistencias-puntos-qr',
    'asistencias-reportes',
  )
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query() query: FindBranchesQueryDto,
  ) {
    return this.branchesService.findAll(
      this.getEmpresaId(user),
      getCommercialScope(user),
      query,
    );
  }

  @Post()
  @RequireModule('sucursales', 'asistencias-configuracion')
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateBranchDto) {
    return this.branchesService.create(
      this.getEmpresaId(user),
      getCommercialScope(user),
      this.prepareAttendanceBranchDto(user, dto, 'create'),
    );
  }

  @Patch(':id')
  @RequireModule('sucursales', 'asistencias-configuracion')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBranchDto,
  ) {
    return this.branchesService.update(
      this.getEmpresaId(user),
      getCommercialScope(user),
      BigInt(id),
      this.prepareAttendanceBranchDto(user, dto, 'update'),
    );
  }

  @Delete(':id')
  @RequireModule('sucursales', 'asistencias-configuracion')
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.branchesService.remove(
      this.getEmpresaId(user),
      getCommercialScope(user),
      BigInt(id),
    );
  }

  private getEmpresaId(user: JwtPayload) {
    if (!user.empresaId) {
      throw new UnauthorizedException('El usuario no tiene empresa activa');
    }

    return BigInt(user.empresaId);
  }

  private prepareAttendanceBranchDto<T extends CreateBranchDto | UpdateBranchDto>(
    user: JwtPayload,
    dto: T,
    action: 'create' | 'update',
  ): T {
    if (user.moduleKeys?.includes('sucursales')) {
      return dto;
    }
    return {
      ...dto,
      ...(action === 'create' ? { tipo: 'asistencia' } : {}),
      esPrincipal: false,
      modoCajaHabilitado: false,
      codigoEstablecimientoSunat: null,
    };
  }
}
