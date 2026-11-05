import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseEnumPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { BillingEnvironment } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PdfConcurrencyService } from '../../common/pdf/pdf-concurrency.service';
import { rateLimits } from '../../common/rate-limits';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { PlatformAdminGuard } from '../platform-admin/platform-admin.guard';
import {
  CreateExtraChargeDto,
  CreatePlatformCreditNoteDto,
  FindPlatformReceiptsDto,
  FindPlatformSeriesDto,
  IssueHistoricalReceiptDto,
  RequestPlatformCancellationDto,
  UpdatePlatformIssuerDto,
  UploadPlatformCertificateDto,
  UpsertPlatformSeriesDto,
} from './platform-billing.dto';
import { PlatformBillingService } from './platform-billing.service';
import { PlatformBillingIntegrationService } from './platform-billing-integration.service';
import { UpdateBillingCredentialsDto } from '../billing-integration/dto/billing-config.dto';

@UseGuards(PlatformAdminGuard)
@Controller('platform-admin/billing')
export class PlatformBillingAdminController {
  constructor(
    private readonly billing: PlatformBillingService,
    private readonly integration: PlatformBillingIntegrationService,
    private readonly pdfConcurrency: PdfConcurrencyService,
  ) {}

  @Get('issuer') async getIssuer() {
    const [issuer, billing] = await Promise.all([
      this.billing.getIssuerConfig(),
      this.integration.status(),
    ]);
    return { ...issuer, billing };
  }
  @Patch('issuer') async updateIssuer(
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdatePlatformIssuerDto,
  ) {
    const issuer = await this.billing.updateIssuerConfig(user, dto);
    return { ...issuer, billing: await this.integration.status() };
  }

  @Post('issuer/provision')
  provisionIssuer(
    @Body('environment', new ParseEnumPipe(BillingEnvironment))
    environment: BillingEnvironment,
  ) {
    return this.integration.provision(environment);
  }

  @Put('issuer/:environment/credentials')
  updateIssuerCredentials(
    @Param('environment', new ParseEnumPipe(BillingEnvironment))
    environment: BillingEnvironment,
    @Body() dto: UpdateBillingCredentialsDto,
  ) {
    return this.integration.updateCredentials(environment, dto);
  }

  @Put('issuer/:environment/certificate')
  @UseInterceptors(
    FileInterceptor('certificate', {
      storage: memoryStorage(),
      limits: { fileSize: 2 * 1024 * 1024 },
    }),
  )
  uploadBillingCertificate(
    @Param('environment', new ParseEnumPipe(BillingEnvironment))
    environment: BillingEnvironment,
    @Body('password') password: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No se recibio el certificado');
    if (!password?.trim())
      throw new BadRequestException('Ingresa la contrasena del certificado');
    return this.integration.uploadCertificate(environment, password, file);
  }

  @Delete('issuer/:environment/certificate')
  deleteBillingCertificate(
    @Param('environment', new ParseEnumPipe(BillingEnvironment))
    environment: BillingEnvironment,
  ) {
    return this.integration.deleteCertificate(environment);
  }

  @Put('issuer/enabled')
  setBillingEnabled(@Body('enabled') enabled: boolean) {
    return this.integration.setEnabled(Boolean(enabled));
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
  @Post('receipts/:id/retry')
  @Throttle(rateLimits.sunat)
  retry(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.billing.retry(user, id);
  }
  @Post('receipts/:id/cancel')
  @Throttle(rateLimits.sunat)
  cancel(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: RequestPlatformCancellationDto,
  ) {
    return this.billing.requestCancellation(user, id, dto);
  }
  @Post('receipts/:id/credit-note')
  @Throttle(rateLimits.sunat)
  createCreditNote(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: CreatePlatformCreditNoteDto,
  ) {
    return this.billing.createCreditNote(user, id, dto);
  }
  @Get('receipts/:id/cancellation/download/:kind')
  @Throttle(rateLimits.sunat)
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
    if ('url' in file && file.url) return response.redirect(file.url);
    if (!('buffer' in file))
      throw new BadRequestException('Archivo no disponible');
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.fileName}"`,
    );
    response.send(file.buffer);
  }
  @Post('extra-charges') createExtraCharge(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateExtraChargeDto,
  ) {
    return this.billing.createExtraCharge(user, dto);
  }

  @Get('receipts/:id/download/:kind')
  @Throttle(rateLimits.pdf)
  async download(
    @Param('id') id: string,
    @Param('kind') kind: string,
    @Res() response: Response,
  ) {
    if (!['pdf', 'xml', 'cdr'].includes(kind))
      throw new BadRequestException('Formato no valido');
    const file =
      kind === 'pdf'
        ? await this.pdfConcurrency.run(() => this.billing.download(id, 'pdf'))
        : await this.billing.download(id, kind as 'xml' | 'cdr');
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
  constructor(
    private readonly billing: PlatformBillingService,
    private readonly pdfConcurrency: PdfConcurrencyService,
  ) {}

  @Get()
  find(
    @CurrentUser() user: JwtPayload,
    @Query() query: FindPlatformReceiptsDto,
  ) {
    return this.billing.findReceipts(query, this.ownerCompany(user));
  }

  @Get(':id/download/:kind')
  @Throttle(rateLimits.pdf)
  async download(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('kind') kind: string,
    @Res() response: Response,
  ) {
    if (!['pdf', 'xml', 'cdr'].includes(kind))
      throw new BadRequestException('Formato no valido');
    const empresaId = this.ownerCompany(user);
    const file =
      kind === 'pdf'
        ? await this.pdfConcurrency.run(() =>
            this.billing.download(id, 'pdf', empresaId),
          )
        : await this.billing.download(id, kind as 'xml' | 'cdr', empresaId);
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
