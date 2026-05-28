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
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { QuotationsPdfService } from './quotations-pdf.service';
import { QuotationsService } from './quotations.service';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import { FindQuotationsQueryDto } from './dto/find-quotations-query.dto';
import { AnnulQuotationDto } from './dto/annul-quotation.dto';
import { ConvertQuotationToSaleDto } from './dto/convert-quotation-to-sale.dto';

@UseGuards(JwtAuthGuard)
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
      this.getUserId(user),
      dto,
    );
  }

  @Get()
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query() query: FindQuotationsQueryDto,
  ) {
    return this.quotationsService.findAll(this.getEmpresaId(user), query);
  }

  @Get(':publicId/pdf')
  async generatePdf(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
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
    return this.quotationsService.findOne(this.getEmpresaId(user), publicId);
  }

  @Patch(':publicId')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Body() dto: UpdateQuotationDto,
  ) {
    return this.quotationsService.update(
      this.getEmpresaId(user),
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
    return this.quotationsService.annul(this.getEmpresaId(user), publicId, dto);
  }

  @Post(':publicId/convert-to-sale')
  convertToSale(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Body() dto: ConvertQuotationToSaleDto,
  ) {
    return this.quotationsService.convertToSale(
      this.getEmpresaId(user),
      this.getUserId(user),
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
