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
import { UpdateEnvioConfigDto } from './dto/update-envio-config.dto';
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
    );
  }

  private getEmpresaId(user: JwtPayload) {
    if (!user.empresaId) {
      throw new UnauthorizedException('El usuario no tiene empresa activa');
    }

    return BigInt(user.empresaId);
  }
}
