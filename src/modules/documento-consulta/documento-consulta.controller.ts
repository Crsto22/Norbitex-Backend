import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { rateLimits } from '../../common/rate-limits';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { DocumentoConsultaService } from './documento-consulta.service';

@UseGuards(ModuleAccessGuard)
@RequireModule(
  'clientes',
  'ventas-pos',
  'cotizaciones',
  'empresa',
  'asistencias-personal',
)
@Throttle(rateLimits.sunat)
@Controller('documento')
export class DocumentoConsultaController {
  constructor(
    private readonly documentoConsultaService: DocumentoConsultaService,
  ) {}

  @Get('dni/:dni')
  consultarDni(@CurrentUser() user: JwtPayload, @Param('dni') dni: string) {
    return this.documentoConsultaService.consultarDni(user, dni);
  }

  @Get('ruc/:ruc')
  consultarRuc(@CurrentUser() user: JwtPayload, @Param('ruc') ruc: string) {
    return this.documentoConsultaService.consultarRuc(user, ruc);
  }
}
