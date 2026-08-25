import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { UpdateSunatConfigDto } from '../sunat-config/dto/update-sunat-config.dto';
import { UploadSunatCertificateDto } from '../sunat-config/dto/upload-sunat-certificate.dto';
import {
  FindPlatformSunatCompaniesQueryDto,
  UpdatePlatformCompanyFiscalDto,
} from './dto/platform-sunat.dto';
import { PlatformAdminGuard } from './platform-admin.guard';
import { PlatformSunatService } from './platform-sunat.service';

@UseGuards(PlatformAdminGuard)
@Controller('platform-admin/sunat')
export class PlatformSunatController {
  constructor(private readonly platformSunatService: PlatformSunatService) {}

  @Get('companies')
  findCompanies(@Query() query: FindPlatformSunatCompaniesQueryDto) {
    return this.platformSunatService.findCompanies(query);
  }

  @Get('companies/:id')
  findCompany(@Param('id') id: string) {
    return this.platformSunatService.findCompany(id);
  }

  @Patch('companies/:id/fiscal')
  updateFiscal(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdatePlatformCompanyFiscalDto,
  ) {
    return this.platformSunatService.updateFiscal(user, id, dto);
  }

  @Patch('companies/:id/config')
  updateConfig(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateSunatConfigDto,
  ) {
    return this.platformSunatService.updateConfig(user, id, dto);
  }

  @Post('companies/:id/certificate')
  @UseInterceptors(
    FileInterceptor('certificate', {
      storage: memoryStorage(),
      limits: { fileSize: 2 * 1024 * 1024 },
    }),
  )
  uploadCertificate(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UploadSunatCertificateDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No se recibio ningun certificado');
    }

    return this.platformSunatService.uploadCertificate(user, id, dto, file);
  }

  @Delete('companies/:id/certificate')
  deleteCertificate(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.platformSunatService.deleteCertificate(user, id);
  }
}
