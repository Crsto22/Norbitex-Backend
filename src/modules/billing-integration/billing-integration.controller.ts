import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseEnumPipe,
  Post,
  Put,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { BillingEnvironment } from '@prisma/client';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { BillingIntegrationService } from './billing-integration.service';
import {
  ProvisionBillingDto,
  SetBillingEnabledDto,
  UpdateBillingCredentialsDto,
  UploadBillingCertificateDto,
} from './dto/billing-config.dto';

@UseGuards(ModuleAccessGuard)
@RequireModule('empresa')
@Controller('company/billing-config')
export class BillingIntegrationController {
  constructor(private readonly integration: BillingIntegrationService) {}

  @Get()
  get(@CurrentUser() user: JwtPayload) {
    return this.integration.getStatus(this.empresaId(user));
  }

  @Post('provision')
  provision(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ProvisionBillingDto,
  ) {
    return this.integration.provision(this.empresaId(user), dto.environment);
  }

  @Put(':environment/credentials')
  updateCredentials(
    @CurrentUser() user: JwtPayload,
    @Param('environment', new ParseEnumPipe(BillingEnvironment))
    environment: BillingEnvironment,
    @Body() dto: UpdateBillingCredentialsDto,
  ) {
    return this.integration.updateCredentials(
      this.empresaId(user),
      environment,
      dto,
    );
  }

  @Put(':environment/certificate')
  @UseInterceptors(
    FileInterceptor('certificate', {
      storage: memoryStorage(),
      limits: { fileSize: 2 * 1024 * 1024 },
    }),
  )
  uploadCertificate(
    @CurrentUser() user: JwtPayload,
    @Param('environment', new ParseEnumPipe(BillingEnvironment))
    environment: BillingEnvironment,
    @Body() dto: UploadBillingCertificateDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) throw new BadRequestException('Adjunta el certificado');
    return this.integration.uploadCertificate(
      this.empresaId(user),
      environment,
      dto,
      file,
    );
  }

  @Delete(':environment/certificate')
  deleteCertificate(
    @CurrentUser() user: JwtPayload,
    @Param('environment', new ParseEnumPipe(BillingEnvironment))
    environment: BillingEnvironment,
  ) {
    return this.integration.deleteCertificate(
      this.empresaId(user),
      environment,
    );
  }

  @Put('enabled')
  setEnabled(
    @CurrentUser() user: JwtPayload,
    @Body() dto: SetBillingEnabledDto,
  ) {
    return this.integration.setEnabled(this.empresaId(user), dto.enabled);
  }

  private empresaId(user: JwtPayload) {
    if (!user.empresaId) {
      throw new UnauthorizedException('El usuario no tiene empresa activa');
    }
    return BigInt(user.empresaId);
  }
}
