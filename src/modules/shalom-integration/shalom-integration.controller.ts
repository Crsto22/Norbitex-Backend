import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Put,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import { rateLimits } from '../../common/rate-limits';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { DocumentoConsultaService } from '../documento-consulta/documento-consulta.service';
import {
  ProvisionShalomProDto,
  RegisterShalomDto,
  UpdateShalomConfigDto,
} from './dto/shalom-config.dto';
import { ShalomIntegrationService } from './shalom-integration.service';
import { ShalomProvisioningService } from './shalom-provisioning.service';
import { ShalomRegistrationService } from './shalom-registration.service';

@UseGuards(ModuleAccessGuard)
@Controller()
export class ShalomIntegrationController {
  constructor(
    private readonly integration: ShalomIntegrationService,
    private readonly provisioning: ShalomProvisioningService,
    private readonly registration: ShalomRegistrationService,
    private readonly documentoConsulta: DocumentoConsultaService,
  ) {}

  // --- Conexion de la cuenta (modulo shalom-pro) ---

  @Get('company/shalom-pro')
  @RequireModule('shalom-pro')
  shalomProStatus(@CurrentUser() user: JwtPayload) {
    return this.provisioning.status(this.empresaId(user));
  }

  @Post('company/shalom-pro/provision')
  @RequireModule('shalom-pro')
  shalomProProvision(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ProvisionShalomProDto,
  ) {
    this.assertManager(user);
    return this.provisioning.provision(this.empresaId(user), dto);
  }

  @Post('company/shalom-pro/validate')
  @RequireModule('shalom-pro')
  shalomProValidate(@CurrentUser() user: JwtPayload) {
    this.assertManager(user);
    return this.provisioning.validate(this.empresaId(user));
  }

  @Post('company/shalom-pro/webhook')
  @RequireModule('shalom-pro')
  shalomProRepairWebhook(@CurrentUser() user: JwtPayload) {
    this.assertManager(user);
    return this.provisioning.repairWebhook(this.empresaId(user));
  }

  @Get('company/shalom-config')
  @RequireModule('empresa')
  getConfig(@CurrentUser() user: JwtPayload) {
    return this.integration.getConfig(this.empresaId(user));
  }

  @Put('company/shalom-config')
  @RequireModule('empresa')
  updateConfig(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateShalomConfigDto,
  ) {
    return this.integration.updateConfig(this.empresaId(user), dto);
  }

  @Post('sales/:publicId/shalom-register')
  @RequireModule('shalom-pro')
  register(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Body() dto: RegisterShalomDto,
  ) {
    return this.registration.register(
      this.empresaId(user),
      publicId,
      dto,
      BigInt(user.sub),
    );
  }

  /** Busqueda de DNI desde el modal de registro (consume 1 consulta del plan). */
  @Get('sales/dni/:dni')
  @RequireModule('shalom-pro')
  @Throttle(rateLimits.sunat)
  lookupDni(@CurrentUser() user: JwtPayload, @Param('dni') dni: string) {
    return this.documentoConsulta.consultarDni(user, dni);
  }

  @Get('sales/:publicId/shalom')
  @RequireModule('shalom-pro')
  status(@CurrentUser() user: JwtPayload, @Param('publicId') publicId: string) {
    return this.registration.status(this.empresaId(user), publicId);
  }

  @Post('sales/:publicId/shalom-sync')
  @RequireModule('shalom-pro')
  sync(@CurrentUser() user: JwtPayload, @Param('publicId') publicId: string) {
    return this.registration.sync(this.empresaId(user), publicId);
  }

  /** Rastreo manual: consulta el estado actual en Shalom. */
  @Post('sales/:publicId/shalom-track')
  @RequireModule('shalom-pro')
  @Throttle(rateLimits.reports)
  track(@CurrentUser() user: JwtPayload, @Param('publicId') publicId: string) {
    return this.registration.track(this.empresaId(user), publicId);
  }

  private empresaId(user: JwtPayload) {
    if (!user.empresaId) {
      throw new UnauthorizedException('El usuario no tiene empresa activa');
    }
    return BigInt(user.empresaId);
  }

  private assertManager(user: JwtPayload) {
    if (!user.roles?.includes('OWNER') && !user.roles?.includes('ADMIN')) {
      throw new ForbiddenException(
        'Solo el propietario o un administrador puede conectar Shalom',
      );
    }
  }
}
