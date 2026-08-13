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
  retrySunat(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ) {
    return this.sunatCreditNoteEmissionService.retry(
      this.getEmpresaId(user),
      publicId,
    );
  }

  @Get(':publicId/sunat/xml')
  @Throttle(rateLimits.sunat)
  async downloadSunatXml(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Res() response: Response,
  ) {
    const file = await this.sunatCreditNoteEmissionService.downloadArtifact(
      this.getEmpresaId(user),
      publicId,
      'xml',
    );
    return response.redirect(file.url);
  }

  @Get(':publicId/sunat/cdr')
  @Throttle(rateLimits.sunat)
  async downloadSunatCdr(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Res() response: Response,
  ) {
    const file = await this.sunatCreditNoteEmissionService.downloadArtifact(
      this.getEmpresaId(user),
      publicId,
      'cdr',
    );
    return response.redirect(file.url);
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
