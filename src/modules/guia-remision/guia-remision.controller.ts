import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import {
  getCommercialScope,
  resolveScopedBranchId,
} from '../../common/commercial-access';
import { GuiaScopeGuard } from './guards/guia-scope.guard';
import {
  AnnulGuiaRemisionDto,
  AutocompletarGuiaVentaQueryDto,
  CreateGuiaRemisionDto,
  FindGuiasRemisionQueryDto,
  UpdateGuiaRemisionDto,
} from './dto/guia-remision.dto';
import { GuiaRemisionPdfService } from './guia-remision-pdf.service';
import { GuiaRemisionService } from './guia-remision.service';

@UseGuards(ModuleAccessGuard, GuiaScopeGuard)
@RequireModule('gre-remitente')
@Controller('guia-remision')
export class GuiaRemisionController {
  constructor(
    private readonly guiaRemisionService: GuiaRemisionService,
    private readonly guiaRemisionPdfService: GuiaRemisionPdfService,
  ) {}

  @Get('autocompletar/venta')
  autocompletarVenta(
    @CurrentUser() user: JwtPayload,
    @Query() query: AutocompletarGuiaVentaQueryDto,
  ) {
    return this.guiaRemisionService.autocompletarDesdeVenta(
      this.getEmpresaId(user),
      getCommercialScope(user),
      query,
    );
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateGuiaRemisionDto) {
    dto.sucursalId = resolveScopedBranchId(
      getCommercialScope(user),
      dto.sucursalId,
    )?.toString();
    return this.guiaRemisionService.create(
      this.getEmpresaId(user),
      this.getUserId(user),
      dto,
    );
  }

  @Get()
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query() query: FindGuiasRemisionQueryDto,
  ) {
    const scope = getCommercialScope(user);
    query.sucursalId = resolveScopedBranchId(
      scope,
      query.sucursalId,
    )?.toString();
    return this.guiaRemisionService.findAll(
      this.getEmpresaId(user),
      scope,
      query,
    );
  }

  @Get(':publicId/pdf')
  async pdf(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const pdf = await this.guiaRemisionPdfService.generatePdf(
      this.getEmpresaId(user),
      publicId,
    );
    response.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="guia-remision-${publicId}.pdf"`,
      'Content-Length': pdf.length,
    });

    return new StreamableFile(pdf);
  }

  @Get(':publicId/sunat/xml')
  async downloadXml(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Res() response: Response,
  ) {
    const file = await this.guiaRemisionService.downloadSunatArtifact(
      this.getEmpresaId(user),
      publicId,
      'xml',
    );
    return response.redirect(file.url);
  }

  @Get(':publicId/sunat/cdr')
  async downloadCdr(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Res() response: Response,
  ) {
    const file = await this.guiaRemisionService.downloadSunatArtifact(
      this.getEmpresaId(user),
      publicId,
      'cdr',
    );
    return response.redirect(file.url);
  }

  @Post(':publicId/emitir')
  emitir(@CurrentUser() user: JwtPayload, @Param('publicId') publicId: string) {
    return this.guiaRemisionService.emitir(this.getEmpresaId(user), publicId);
  }

  @Post(':publicId/consultar-cdr')
  consultarCdr(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ) {
    return this.guiaRemisionService.consultarCdr(
      this.getEmpresaId(user),
      publicId,
    );
  }

  @Get(':publicId')
  findOne(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ) {
    return this.guiaRemisionService.findOne(this.getEmpresaId(user), publicId);
  }

  @Patch(':publicId')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Body() dto: UpdateGuiaRemisionDto,
  ) {
    return this.guiaRemisionService.update(
      this.getEmpresaId(user),
      publicId,
      dto,
    );
  }

  @Delete(':publicId')
  remove(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Body() dto: AnnulGuiaRemisionDto,
  ) {
    return this.guiaRemisionService.annul(
      this.getEmpresaId(user),
      publicId,
      dto,
    );
  }

  private getEmpresaId(user: JwtPayload) {
    if (!user.empresaId) {
      throw new UnauthorizedException('El usuario no tiene empresa activa');
    }

    return BigInt(user.empresaId);
  }

  private getUserId(user: JwtPayload) {
    if (!user.sub) {
      throw new UnauthorizedException('Usuario no autenticado');
    }

    return user.sub;
  }
}
