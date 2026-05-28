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
import { SalesPdfService } from './sales-pdf.service';
import { SalesService } from './sales.service';
import { CreateSaleDto } from './dto/create-sale.dto';
import { FindSalesQueryDto } from './dto/find-sales-query.dto';
import { FindSaleProductsQueryDto } from './dto/find-sale-products-query.dto';
import { FindSeriesQueryDto } from './dto/find-series-query.dto';
import { AnnulSaleDto } from './dto/annul-sale.dto';
import {
  CreateSerieComprobanteDto,
  UpdateSerieComprobanteDto,
} from './dto/serie-comprobante.dto';

@UseGuards(JwtAuthGuard)
@Controller('sales')
export class SalesController {
  constructor(
    private readonly salesService: SalesService,
    private readonly salesPdfService: SalesPdfService,
  ) {}

  // ── Products (static route BEFORE :publicId) ────────────────────────

  @Get('products')
  findProducts(
    @CurrentUser() user: JwtPayload,
    @Query() query: FindSaleProductsQueryDto,
  ) {
    return this.salesService.findProducts(this.getEmpresaId(user), query);
  }

  // ── Series (static routes BEFORE :publicId) ────────────────────────

  @Get('series')
  findSeries(
    @CurrentUser() user: JwtPayload,
    @Query() query: FindSeriesQueryDto,
  ) {
    return this.salesService.findSeries(this.getEmpresaId(user), query);
  }

  @Post('series')
  createSerie(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateSerieComprobanteDto,
  ) {
    return this.salesService.createSerie(this.getEmpresaId(user), dto);
  }

  @Patch('series/:id')
  updateSerie(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateSerieComprobanteDto,
  ) {
    return this.salesService.updateSerie(this.getEmpresaId(user), id, dto);
  }

  // ── Sales ──────────────────────────────────────────────────────────

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateSaleDto) {
    return this.salesService.create(
      this.getEmpresaId(user),
      this.getUserId(user),
      dto,
    );
  }

  @Get()
  findAll(@CurrentUser() user: JwtPayload, @Query() query: FindSalesQueryDto) {
    return this.salesService.findAll(this.getEmpresaId(user), query);
  }

  @Get(':publicId/pdf')
  async generatePdf(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const pdf = await this.salesPdfService.generateSalePdf(
      this.getEmpresaId(user),
      publicId,
    );
    response.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="venta-${publicId}.pdf"`,
      'Content-Length': pdf.length,
    });

    return new StreamableFile(pdf);
  }

  @Get(':publicId')
  findOne(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ) {
    return this.salesService.findOne(this.getEmpresaId(user), publicId);
  }

  @Patch(':publicId/annul')
  annul(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Body() dto: AnnulSaleDto,
  ) {
    return this.salesService.annul(this.getEmpresaId(user), publicId, dto);
  }

  // ── Helpers ─────────────────────────────────────────────────────────

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
