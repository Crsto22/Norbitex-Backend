import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { UpdateDespachoConfigDto } from './dto/update-despacho-config.dto';
import { UpdateEnvioConfigDto } from './dto/update-envio-config.dto';
import { UpdateRecojoConfigDto } from './dto/update-recojo-config.dto';
import { EnviosConfigService } from './envios-config.service';

@UseGuards(ModuleAccessGuard)
@RequireModule('envios-config')
@Controller('envios-config')
export class EnviosConfigController {
  constructor(private readonly enviosConfigService: EnviosConfigService) {}

  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.enviosConfigService.findAll(this.getEmpresaId(user));
  }

  @Get('despacho')
  findDespacho(@CurrentUser() user: JwtPayload) {
    return this.enviosConfigService.getDespacho(this.getEmpresaId(user));
  }

  @Patch('despacho')
  updateDespacho(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateDespachoConfigDto,
  ) {
    return this.enviosConfigService.updateDespacho(
      this.getEmpresaId(user),
      dto.diasSemana,
      dto.horaCorte,
      dto.anticipacionDias ?? 0,
    );
  }

  @Get('recojo')
  findRecojo(@CurrentUser() user: JwtPayload) {
    return this.enviosConfigService.getRecojo(this.getEmpresaId(user));
  }

  @Patch('recojo')
  updateRecojo(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateRecojoConfigDto,
  ) {
    return this.enviosConfigService.updateRecojo(
      this.getEmpresaId(user),
      dto.usarDespacho,
      dto.diasSemana,
      dto.horaCorte,
      dto.anticipacionDias ?? 0,
    );
  }

  @Patch(':metodo')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('metodo') metodo: string,
    @Body() dto: UpdateEnvioConfigDto,
  ) {
    return this.enviosConfigService.update(
      this.getEmpresaId(user),
      metodo.trim().toUpperCase(),
      dto.activo,
      dto.direccion,
    );
  }

  private getEmpresaId(user: JwtPayload) {
    if (!user.empresaId) {
      throw new UnauthorizedException('El usuario no tiene empresa activa');
    }

    return BigInt(user.empresaId);
  }
}
