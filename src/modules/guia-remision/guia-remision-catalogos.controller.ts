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
import {
  CreateCatalogoParticipanteDto,
  CreateCatalogoVehiculoDto,
  FindCatalogosGuiaQueryDto,
  UpdateCatalogoParticipanteDto,
  UpdateCatalogoVehiculoDto,
} from './dto/guia-remision-catalogos.dto';
import { GuiaRemisionCatalogosService } from './guia-remision-catalogos.service';

@UseGuards(ModuleAccessGuard)
@RequireModule('gre-remitente', 'conductores')
@Controller('guia-remision/catalogos')
export class GuiaRemisionCatalogosController {
  constructor(
    private readonly catalogosService: GuiaRemisionCatalogosService,
  ) {}

  @Get('participantes')
  findParticipantes(
    @CurrentUser() user: JwtPayload,
    @Query() query: FindCatalogosGuiaQueryDto,
  ) {
    return this.catalogosService.findParticipantes(
      this.getEmpresaId(user),
      query,
    );
  }

  @Post('participantes')
  createParticipante(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateCatalogoParticipanteDto,
  ) {
    return this.catalogosService.createParticipante(
      this.getEmpresaId(user),
      dto,
    );
  }

  @Patch('participantes/:publicId')
  updateParticipante(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Body() dto: UpdateCatalogoParticipanteDto,
  ) {
    return this.catalogosService.updateParticipante(
      this.getEmpresaId(user),
      publicId,
      dto,
    );
  }

  @Delete('participantes/:publicId')
  removeParticipante(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ) {
    return this.catalogosService.removeParticipante(
      this.getEmpresaId(user),
      publicId,
    );
  }

  @Get('vehiculos')
  findVehiculos(
    @CurrentUser() user: JwtPayload,
    @Query() query: FindCatalogosGuiaQueryDto,
  ) {
    return this.catalogosService.findVehiculos(this.getEmpresaId(user), query);
  }

  @Post('vehiculos')
  createVehiculo(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateCatalogoVehiculoDto,
  ) {
    return this.catalogosService.createVehiculo(this.getEmpresaId(user), dto);
  }

  @Patch('vehiculos/:publicId')
  updateVehiculo(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Body() dto: UpdateCatalogoVehiculoDto,
  ) {
    return this.catalogosService.updateVehiculo(
      this.getEmpresaId(user),
      publicId,
      dto,
    );
  }

  @Delete('vehiculos/:publicId')
  removeVehiculo(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ) {
    return this.catalogosService.removeVehiculo(
      this.getEmpresaId(user),
      publicId,
    );
  }

  private getEmpresaId(user: JwtPayload) {
    if (!user.empresaId) {
      throw new UnauthorizedException('El usuario no tiene empresa activa');
    }

    return BigInt(user.empresaId);
  }
}
