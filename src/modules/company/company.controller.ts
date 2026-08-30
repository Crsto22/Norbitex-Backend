import {
  BadRequestException,
  Body,
  Controller,
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
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { CompanyService } from './company.service';
import { UpdateCompanyDto } from './dto/update-company.dto';

@UseGuards(ModuleAccessGuard)
@Controller('company')
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  @Get('setup-status')
  getSetupStatus(@CurrentUser() user: JwtPayload) {
    return this.companyService.getSetupStatus(this.getEmpresaId(user));
  }

  @Get()
  findOne(@CurrentUser() user: JwtPayload) {
    return this.companyService.findOne(this.getEmpresaId(user));
  }

  @Patch()
  @RequireModule('empresa', 'asistencias-empresa')
  update(@CurrentUser() user: JwtPayload, @Body() dto: UpdateCompanyDto) {
    return this.companyService.update(this.getEmpresaId(user), dto);
  }

  @Post('logo')
  @RequireModule('empresa', 'asistencias-empresa')
  @UseInterceptors(
    FileInterceptor('logo', {
      storage: memoryStorage(),
      limits: {
        fileSize: 5 * 1024 * 1024,
      },
    }),
  )
  uploadLogo(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No se recibio ningun archivo');
    }

    return this.companyService.uploadLogo(this.getEmpresaId(user), file);
  }

  private getEmpresaId(user: JwtPayload) {
    if (!user.empresaId) {
      throw new UnauthorizedException('El usuario no tiene empresa activa');
    }

    return BigInt(user.empresaId);
  }
}
