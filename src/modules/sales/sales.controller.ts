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
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import { PdfConcurrencyService } from '../../common/pdf/pdf-concurrency.service';
import { rateLimits } from '../../common/rate-limits';
import { SaleScopeGuard } from './guards/sale-scope.guard';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { getCommercialScope } from '../../common/commercial-access';
import { SalesPdfService } from './sales-pdf.service';
import { SalesService } from './sales.service';
import { SunatBajaService } from '../sunat-emission/sunat-baja.service';
import { SunatEmissionService } from '../sunat-emission/sunat-emission.service';
import { CreateSaleDto } from './dto/create-sale.dto';
import { ConvertSaleDto } from './dto/convert-sale.dto';
import { DeliverSaleDto } from './dto/deliver-sale.dto';
import {
  FindComprobantesQueryDto,
  FindSalesQueryDto,
} from './dto/find-sales-query.dto';
import { FindSaleProductsQueryDto } from './dto/find-sale-products-query.dto';
import { FindSeriesQueryDto } from './dto/find-series-query.dto';
import { AnnulSaleDto } from './dto/annul-sale.dto';
import {
  CreateSerieComprobanteDto,
  UpdateSerieComprobanteDto,
} from './dto/serie-comprobante.dto';

@UseGuards(ModuleAccessGuard, SaleScopeGuard)
@Controller('sales')
export class SalesController {
  constructor(
    private readonly salesService: SalesService,
    private readonly salesPdfService: SalesPdfService,
    private readonly sunatEmissionService: SunatEmissionService,
    private readonly sunatBajaService: SunatBajaService,
    private readonly pdfConcurrency: PdfConcurrencyService,
  ) {}

  // ── Products (static route BEFORE :publicId) ────────────────────────

  @Get('products')
  @RequireModule('ventas-pos')
  findProducts(
    @CurrentUser() user: JwtPayload,
    @Query() query: FindSaleProductsQueryDto,
  ) {
    return this.salesService.findProducts(
      this.getEmpresaId(user),
      getCommercialScope(user),
      query,
    );
  }

  // ── Series (static routes BEFORE :publicId) ────────────────────────

  @Get('series')
  @RequireModule('ventas-pos', 'series', 'nota-credito', 'gre-remitente')
  findSeries(
    @CurrentUser() user: JwtPayload,
    @Query() query: FindSeriesQueryDto,
  ) {
    return this.salesService.findSeries(
      this.getEmpresaId(user),
      getCommercialScope(user),
      query,
    );
  }

  @Post('series')
  @RequireModule('series')
  createSerie(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateSerieComprobanteDto,
  ) {
    const scope = getCommercialScope(user);
    if (scope.branchId) {
      dto.aplicaTodasSucursales = false;
      dto.sucursalIds = [scope.branchId.toString()];
    }
    return this.salesService.createSerie(this.getEmpresaId(user), dto);
  }

  @Patch('series/:id')
  @RequireModule('series')
  updateSerie(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateSerieComprobanteDto,
  ) {
    const scope = getCommercialScope(user);
    if (scope.branchId) {
      dto.aplicaTodasSucursales = false;
      dto.sucursalIds = [scope.branchId.toString()];
    }
    return this.salesService.updateSerie(this.getEmpresaId(user), id, dto);
  }

  // ── Sales ──────────────────────────────────────────────────────────

  @Post()
  @RequireModule('ventas-pos')
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateSaleDto) {
    return this.salesService.create(
      this.getEmpresaId(user),
      getCommercialScope(user),
      dto,
    );
  }

  @Get()
  @RequireModule('historial-ventas')
  findAll(@CurrentUser() user: JwtPayload, @Query() query: FindSalesQueryDto) {
    return this.salesService.findAll(
      this.getEmpresaId(user),
      getCommercialScope(user),
      query,
    );
  }

  @Get('comprobantes')
  @RequireModule('comprobantes')
  findComprobantes(
    @CurrentUser() user: JwtPayload,
    @Query() query: FindComprobantesQueryDto,
  ) {
    return this.salesService.findComprobantes(
      this.getEmpresaId(user),
      getCommercialScope(user),
      query,
    );
  }

  @Get('deliveries')
  @RequireModule('entregas-pendientes')
  findDeliveries(
    @CurrentUser() user: JwtPayload,
    @Query('estado') estado?: 'pendiente' | 'entregada',
  ) {
    return this.salesService.findDeliveries(
      this.getEmpresaId(user),
      getCommercialScope(user),
      estado === 'entregada' ? 'entregada' : 'pendiente',
    );
  }

  @Get(':publicId/pdf')
  @RequireModule('historial-ventas', 'comprobantes')
  @Throttle(rateLimits.pdf)
  async generatePdf(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const pdf = await this.pdfConcurrency.run(() =>
      this.salesPdfService.generateSalePdf(this.getEmpresaId(user), publicId),
    );
    response.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="venta-${publicId}.pdf"`,
      'Content-Length': pdf.length,
    });

    return new StreamableFile(pdf);
  }

  @Get(':publicId/ticket')
  @RequireModule('historial-ventas', 'comprobantes')
  @Throttle(rateLimits.pdf)
  async generateTicket(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const pdf = await this.pdfConcurrency.run(() =>
      this.salesPdfService.generateSaleTicketPdf(
        this.getEmpresaId(user),
        publicId,
      ),
    );
    response.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="ticket-${publicId}.pdf"`,
      'Content-Length': pdf.length,
    });

    return new StreamableFile(pdf);
  }

  @Get(':publicId/sunat')
  @RequireModule('historial-ventas', 'comprobantes')
  @Throttle(rateLimits.sunat)
  getSunatStatus(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ) {
    return this.sunatEmissionService.getSaleSunatStatus(
      this.getEmpresaId(user),
      publicId,
    );
  }

  @Post(':publicId/sunat/retry')
  @RequireModule('historial-ventas', 'comprobantes')
  @Throttle(rateLimits.sunat)
  retrySunat(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ) {
    return this.sunatEmissionService.retrySale(
      this.getEmpresaId(user),
      publicId,
    );
  }

  @Get(':publicId/sunat/xml')
  @RequireModule('historial-ventas', 'comprobantes')
  @Throttle(rateLimits.sunat)
  async downloadSunatXml(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Res() response: Response,
  ) {
    const file = await this.sunatEmissionService.downloadSaleArtifact(
      this.getEmpresaId(user),
      publicId,
      'xml',
    );
    return this.sendSignedArtifact(response, file, 'application/xml');
  }

  @Get(':publicId/sunat/cdr')
  @RequireModule('historial-ventas', 'comprobantes')
  @Throttle(rateLimits.sunat)
  async downloadSunatCdr(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Res() response: Response,
  ) {
    const file = await this.sunatEmissionService.downloadSaleArtifact(
      this.getEmpresaId(user),
      publicId,
      'cdr',
    );
    return this.sendSignedArtifact(response, file, 'application/zip');
  }

  @Post(':publicId/sunat/baja/consultar-ticket')
  @RequireModule('historial-ventas', 'comprobantes')
  @Throttle(rateLimits.sunat)
  consultarTicketBajaSunat(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ) {
    return this.sunatBajaService.consultarBajaVenta(
      this.getEmpresaId(user),
      publicId,
    );
  }

  @Get(':publicId/sunat/baja/xml')
  @RequireModule('historial-ventas', 'comprobantes')
  @Throttle(rateLimits.sunat)
  async downloadSunatBajaXml(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Res() response: Response,
  ) {
    const file = await this.sunatBajaService.downloadBajaArtifact(
      this.getEmpresaId(user),
      publicId,
      'xml',
    );
    return this.sendSignedArtifact(response, file, 'application/xml');
  }

  @Get(':publicId/sunat/baja/cdr')
  @RequireModule('historial-ventas', 'comprobantes')
  @Throttle(rateLimits.sunat)
  async downloadSunatBajaCdr(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Res() response: Response,
  ) {
    const file = await this.sunatBajaService.downloadBajaArtifact(
      this.getEmpresaId(user),
      publicId,
      'cdr',
    );
    return this.sendSignedArtifact(response, file, 'application/zip');
  }

  @Get(':publicId')
  @RequireModule('historial-ventas', 'comprobantes')
  findOne(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ) {
    return this.salesService.findOne(
      this.getEmpresaId(user),
      getCommercialScope(user),
      publicId,
    );
  }

  @Post(':publicId/convert')
  @RequireModule('historial-ventas')
  convert(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Body() dto: ConvertSaleDto,
  ) {
    return this.salesService.convertSaleDocument(
      this.getEmpresaId(user),
      getCommercialScope(user),
      publicId,
      dto,
    );
  }

  @Post(':publicId/deliver')
  @RequireModule('entregas-pendientes')
  deliver(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Body() dto: DeliverSaleDto,
  ) {
    return this.salesService.deliverSale(
      this.getEmpresaId(user),
      getCommercialScope(user),
      publicId,
      dto,
    );
  }

  @Patch(':publicId/annul')
  @RequireModule('historial-ventas')
  annul(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Body() dto: AnnulSaleDto,
  ) {
    return this.salesService.annul(
      this.getEmpresaId(user),
      getCommercialScope(user),
      publicId,
      dto,
    );
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

  private async sendSignedArtifact(
    response: Response,
    file: { fileName: string; url: string },
    contentType: string,
  ) {
    const artifact = await fetch(file.url);

    if (!artifact.ok) {
      response.status(artifact.status).send('Archivo SUNAT no disponible');
      return;
    }

    const buffer = Buffer.from(await artifact.arrayBuffer());
    response.set({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${file.fileName}"`,
      'Content-Length': buffer.length,
    });

    response.send(buffer);
  }
}
