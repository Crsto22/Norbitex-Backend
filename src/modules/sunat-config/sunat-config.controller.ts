import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { UpdateSunatConfigDto } from './dto/update-sunat-config.dto';
import { UploadSunatCertificateDto } from './dto/upload-sunat-certificate.dto';
import { SunatConfigService } from './sunat-config.service';

@UseGuards(JwtAuthGuard)
@Controller('company/sunat-config')
export class SunatConfigController {
  constructor(private readonly sunatConfigService: SunatConfigService) {}

  @Get()
  findOne(@CurrentUser() user: JwtPayload) {
    return this.sunatConfigService.findOne(this.getEmpresaId(user));
  }

  @Patch()
  update(@CurrentUser() user: JwtPayload, @Body() dto: UpdateSunatConfigDto) {
    return this.sunatConfigService.update(this.getEmpresaId(user), dto);
  }

  @Post('certificate')
  @UseInterceptors(
    FileInterceptor('certificate', {
      storage: memoryStorage(),
      limits: {
        fileSize: 2 * 1024 * 1024,
      },
    }),
  )
  uploadCertificate(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UploadSunatCertificateDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No se recibio ningun certificado');
    }

    return this.sunatConfigService.uploadCertificate(
      this.getEmpresaId(user),
      dto,
      file,
    );
  }

  @Delete('certificate')
  deleteCertificate(@CurrentUser() user: JwtPayload) {
    return this.sunatConfigService.deleteCertificate(this.getEmpresaId(user));
  }

  private getEmpresaId(user: JwtPayload) {
    if (!user.empresaId) {
      throw new UnauthorizedException('El usuario no tiene empresa activa');
    }

    return BigInt(user.empresaId);
  }
}
