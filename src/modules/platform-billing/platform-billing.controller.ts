import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { PlatformAdminGuard } from '../platform-admin/platform-admin.guard';
import {
  CreateExtraChargeDto,
  FindPlatformReceiptsDto,
  FindPlatformSeriesDto,
  IssueHistoricalReceiptDto,
  RequestPlatformCancellationDto,
  UpdatePlatformIssuerDto,
  UploadPlatformCertificateDto,
  UpsertPlatformSeriesDto,
} from './platform-billing.dto';
import { PlatformBillingService } from './platform-billing.service';

@UseGuards(PlatformAdminGuard)
@Controller('platform-admin/billing')
export class PlatformBillingAdminController {
  constructor(private readonly billing: PlatformBillingService) {}

  @Get('issuer') getIssuer() {
    return this.billing.getIssuerConfig();
  }
  @Patch('issuer') updateIssuer(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdatePlatformIssuerDto,
  ) {
    return this.billing.updateIssuerConfig(user, dto);
  }

  @Post('issuer/certificate')
  @UseInterceptors(
    FileInterceptor('certificate', {
      storage: memoryStorage(),
      limits: { fileSize: 2 * 1024 * 1024 },
    }),
  )
  uploadCertificate(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UploadPlatformCertificateDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No se recibio el certificado');
    return this.billing.uploadCertificate(user, dto, file);
  }

  @Get('series') findSeries(@Query() query: FindPlatformSeriesDto) {
    return this.billing.listSeries(query);
  }
  @Post('series') createSeries(@Body() dto: UpsertPlatformSeriesDto) {
    return this.billing.createSeries(dto);
  }
  @Patch('series/:id') updateSeries(
    @Param('id') id: string,
    @Body() dto: UpsertPlatformSeriesDto,
  ) {
    return this.billing.updateSeries(id, dto);
  }

  @Get('receipts') findReceipts(@Query() query: FindPlatformReceiptsDto) {
    return this.billing.findReceipts(query);
  }
  @Post('receipts/historical') issueHistorical(
    @CurrentUser() user: JwtPayload,
    @Body() dto: IssueHistoricalReceiptDto,
  ) {
    return this.billing.issueHistorical(user, dto);
  }
  @Post('receipts/:id/retry') retry(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.billing.retry(user, id);
  }
  @Post('receipts/:id/cancel') cancel(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: RequestPlatformCancellationDto,
  ) {
    return this.billing.requestCancellation(user, id, dto);
  }
  @Get('receipts/:id/cancellation/download/:kind')
  async downloadCancellation(
    @Param('id') id: string,
    @Param('kind') kind: string,
    @Res() response: Response,
  ) {
    if (!['xml', 'cdr'].includes(kind))
      throw new BadRequestException('Formato no valido');
    const file = await this.billing.downloadCancellation(
      id,
      kind as 'xml' | 'cdr',
    );
    response.redirect(file.url);
  }
  @Post('extra-charges') createExtraCharge(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateExtraChargeDto,
  ) {
    return this.billing.createExtraCharge(user, dto);
  }

  @Get('receipts/:id/download/:kind')
  async download(
    @Param('id') id: string,
    @Param('kind') kind: string,
    @Res() response: Response,
  ) {
    if (!['pdf', 'xml', 'cdr'].includes(kind))
      throw new BadRequestException('Formato no valido');
    const file = await this.billing.download(id, kind as 'pdf' | 'xml' | 'cdr');
    if ('url' in file && file.url) return response.redirect(file.url);
    response.setHeader('Content-Type', file.contentType!);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.fileName}"`,
    );
    response.send(file.buffer!);
  }
}
@Controller('billing/receipts')
export class CompanyBillingController {
  constructor(private readonly billing: PlatformBillingService) {}

  @Get()
  find(
    @CurrentUser() user: JwtPayload,
    @Query() query: FindPlatformReceiptsDto,
  ) {
    return this.billing.findReceipts(query, this.ownerCompany(user));
  }

  @Get(':id/download/:kind')
  async download(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('kind') kind: string,
    @Res() response: Response,
  ) {
    if (!['pdf', 'xml', 'cdr'].includes(kind))
      throw new BadRequestException('Formato no valido');
    const file = await this.billing.download(
      id,
      kind as 'pdf' | 'xml' | 'cdr',
      this.ownerCompany(user),
    );
    if ('url' in file && file.url) return response.redirect(file.url);
    response.setHeader('Content-Type', file.contentType!);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.fileName}"`,
    );
    response.send(file.buffer!);
  }

  private ownerCompany(user: JwtPayload) {
    if (!user.empresaId || !user.roles.includes('OWNER'))
      throw new BadRequestException(
        'Solo el propietario puede consultar estos comprobantes',
      );
    return BigInt(user.empresaId);
  }
}
