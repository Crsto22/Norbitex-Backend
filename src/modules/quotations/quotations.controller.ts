import {
  Body,
  Controller,
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
import { getCommercialScope } from '../../common/commercial-access';
import { QuotationsPdfService } from './quotations-pdf.service';
import { QuotationsService } from './quotations.service';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import { FindQuotationsQueryDto } from './dto/find-quotations-query.dto';
import { AnnulQuotationDto } from './dto/annul-quotation.dto';
import { ConvertQuotationToSaleDto } from './dto/convert-quotation-to-sale.dto';

@UseGuards(ModuleAccessGuard)
@RequireModule('cotizaciones', 'historial-cotizaciones')
@Controller('quotations')
export class QuotationsController {
  constructor(
    private readonly quotationsService: QuotationsService,
    private readonly quotationsPdfService: QuotationsPdfService,
  ) {}

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateQuotationDto) {
    return this.quotationsService.create(
      this.getEmpresaId(user),
      getCommercialScope(user),
      dto,
    );
  }

  @Get()
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query() query: FindQuotationsQueryDto,
  ) {
    return this.quotationsService.findAll(
      this.getEmpresaId(user),
      getCommercialScope(user),
      query,
    );
  }

  @Get(':publicId/pdf')
  async generatePdf(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.quotationsService.findOne(
      this.getEmpresaId(user),
      getCommercialScope(user),
      publicId,
    );
    const pdf = await this.quotationsPdfService.generateQuotationPdf(
      this.getEmpresaId(user),
      publicId,
    );
    response.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="cotizacion-${publicId}.pdf"`,
      'Content-Length': pdf.length,
    });

    return new StreamableFile(pdf);
  }

  @Get(':publicId')
  findOne(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ) {
    return this.quotationsService.findOne(
      this.getEmpresaId(user),
      getCommercialScope(user),
      publicId,
    );
  }

  @Patch(':publicId')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Body() dto: UpdateQuotationDto,
  ) {
    return this.quotationsService.update(
      this.getEmpresaId(user),
      getCommercialScope(user),
      publicId,
      dto,
    );
  }

  @Patch(':publicId/annul')
  annul(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Body() dto: AnnulQuotationDto,
  ) {
    return this.quotationsService.annul(
      this.getEmpresaId(user),
      getCommercialScope(user),
      publicId,
      dto,
    );
  }

  @Post(':publicId/convert-to-sale')
  convertToSale(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Body() dto: ConvertQuotationToSaleDto,
  ) {
    return this.quotationsService.convertToSale(
      this.getEmpresaId(user),
      getCommercialScope(user),
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
