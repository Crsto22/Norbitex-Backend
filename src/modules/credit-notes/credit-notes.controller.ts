import {
  Body,
  Controller,
  Get,
  Param,
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
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { getCommercialScope } from '../../common/commercial-access';
import { CreditNoteScopeGuard } from './guards/credit-note-scope.guard';
import { SalesService } from '../sales/sales.service';
import { SunatCreditNoteEmissionService } from '../sunat-emission/sunat-credit-note-emission.service';
import { CreditNotePdfService } from './credit-note-pdf.service';
import { CreditNotesService } from './credit-notes.service';
import { BillingCreditNoteService } from '../billing-integration/billing-credit-note.service';
import {
  CreateCreditNoteDto,
  FindCreditNotesQueryDto,
} from './dto/credit-note.dto';

@UseGuards(ModuleAccessGuard, CreditNoteScopeGuard)
@RequireModule('nota-credito')
@Controller('credit-notes')
export class CreditNotesController {
  constructor(
    private readonly creditNotesService: CreditNotesService,
    private readonly creditNotePdfService: CreditNotePdfService,
    private readonly sunatCreditNoteEmissionService: SunatCreditNoteEmissionService,
    private readonly salesService: SalesService,
    private readonly pdfConcurrency: PdfConcurrencyService,
    private readonly billingCreditNotes: BillingCreditNoteService,
  ) {}

  @Get()
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query() query: FindCreditNotesQueryDto,
  ) {
    return this.creditNotesService.findAll(
      this.getEmpresaId(user),
      getCommercialScope(user),
      query,
    );
  }

  @Post()
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateCreditNoteDto,
  ) {
    await this.salesService.findOne(
      this.getEmpresaId(user),
      getCommercialScope(user),
      dto.ventaPublicId,
    );
    return this.creditNotesService.create(
      this.getEmpresaId(user),
      this.getUserId(user),
      dto,
    );
  }

  @Get(':publicId/pdf')
  @Throttle(rateLimits.pdf)
  async generatePdf(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const note = await this.creditNotesService.findOne(
      this.getEmpresaId(user),
      getCommercialScope(user),
      publicId,
    );
    if (note.billing) {
      const file = await this.billingCreditNotes.artifact(
        this.getEmpresaId(user),
        publicId,
        'PDF_A4',
      );
      response.set({
        'Content-Type': file.contentType,
        'Content-Disposition': `inline; filename="${file.filename}"`,
        'Content-Length': file.buffer.length,
      });
      return new StreamableFile(file.buffer);
    }
    const pdf = await this.pdfConcurrency.run(() =>
      this.creditNotePdfService.generatePdf(this.getEmpresaId(user), publicId),
    );
    response.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="nota-credito-${publicId}.pdf"`,
      'Content-Length': pdf.length,
    });

    return new StreamableFile(pdf);
  }

  @Post(':publicId/sunat/retry')
  @Throttle(rateLimits.sunat)
  async retrySunat(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ) {
    const empresaId = this.getEmpresaId(user);
    const note = await this.creditNotesService.findOne(
      empresaId,
      getCommercialScope(user),
      publicId,
    );
    return note.billing
      ? this.billingCreditNotes.retry(empresaId, publicId)
      : this.sunatCreditNoteEmissionService.retry(empresaId, publicId);
  }

  @Get(':publicId/sunat/xml')
  @Throttle(rateLimits.sunat)
  async downloadSunatXml(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const empresaId = this.getEmpresaId(user);
    const note = await this.creditNotesService.findOne(
      empresaId,
      getCommercialScope(user),
      publicId,
    );
    if (note.billing) {
      const file = await this.billingCreditNotes.artifact(
        empresaId,
        publicId,
        'XML',
      );
      response.set({
        'Content-Type': file.contentType,
        'Content-Disposition': `attachment; filename="${file.filename}"`,
        'Content-Length': file.buffer.length,
      });
      return new StreamableFile(file.buffer);
    }
    const file = await this.sunatCreditNoteEmissionService.downloadArtifact(
      empresaId,
      publicId,
      'xml',
    );
    response.redirect(file.url);
  }

  @Get(':publicId/sunat/cdr')
  @Throttle(rateLimits.sunat)
  async downloadSunatCdr(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const empresaId = this.getEmpresaId(user);
    const note = await this.creditNotesService.findOne(
      empresaId,
      getCommercialScope(user),
      publicId,
    );
    if (note.billing) {
      const file = await this.billingCreditNotes.artifact(
        empresaId,
        publicId,
        'CDR',
      );
      response.set({
        'Content-Type': file.contentType,
        'Content-Disposition': `attachment; filename="${file.filename}"`,
        'Content-Length': file.buffer.length,
      });
      return new StreamableFile(file.buffer);
    }
    const file = await this.sunatCreditNoteEmissionService.downloadArtifact(
      empresaId,
      publicId,
      'cdr',
    );
    response.redirect(file.url);
  }

  @Get(':publicId')
  findOne(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ) {
    return this.creditNotesService.findOne(
      this.getEmpresaId(user),
      getCommercialScope(user),
      publicId,
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
