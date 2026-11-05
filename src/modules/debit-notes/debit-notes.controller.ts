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
import { getCommercialScope } from '../../common/commercial-access';
import { rateLimits } from '../../common/rate-limits';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { BillingDebitNoteService } from '../billing-integration/billing-debit-note.service';
import { DebitNotesService } from './debit-notes.service';
import {
  CreateDebitNoteDto,
  FindDebitNotesQueryDto,
} from './dto/debit-note.dto';

@UseGuards(ModuleAccessGuard)
@RequireModule('nota-debito')
@Controller('debit-notes')
export class DebitNotesController {
  constructor(
    private readonly notes: DebitNotesService,
    private readonly billing: BillingDebitNoteService,
  ) {}

  @Get()
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query() query: FindDebitNotesQueryDto,
  ) {
    return this.notes.findAll(
      this.empresaId(user),
      getCommercialScope(user),
      query,
    );
  }

  @Get('eligible-sales')
  eligibleSales(
    @CurrentUser() user: JwtPayload,
    @Query('search') search?: string,
  ) {
    return this.notes.findEligibleSales(this.empresaId(user), search);
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateDebitNoteDto) {
    return this.notes.create(this.empresaId(user), this.userId(user), dto);
  }

  @Post(':publicId/sunat/retry')
  @Throttle(rateLimits.sunat)
  async retry(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ) {
    await this.notes.findOne(
      this.empresaId(user),
      getCommercialScope(user),
      publicId,
    );
    return this.billing.retry(this.empresaId(user), publicId);
  }

  @Get(':publicId/pdf')
  @Throttle(rateLimits.pdf)
  pdf(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.file(user, publicId, 'PDF_A4', response, true);
  }

  @Get(':publicId/ticket')
  @Throttle(rateLimits.pdf)
  ticket(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.file(user, publicId, 'PDF_TICKET', response, true);
  }

  @Get(':publicId/sunat/xml')
  @Throttle(rateLimits.sunat)
  xml(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.file(user, publicId, 'XML', response, false);
  }

  @Get(':publicId/sunat/cdr')
  @Throttle(rateLimits.sunat)
  cdr(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return this.file(user, publicId, 'CDR', response, false);
  }

  @Get(':publicId')
  findOne(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ) {
    return this.notes.findOne(
      this.empresaId(user),
      getCommercialScope(user),
      publicId,
    );
  }

  private async file(
    user: JwtPayload,
    publicId: string,
    type: 'XML' | 'CDR' | 'PDF_A4' | 'PDF_TICKET',
    response: Response,
    inline: boolean,
  ) {
    const empresaId = this.empresaId(user);
    await this.notes.findOne(empresaId, getCommercialScope(user), publicId);
    const file = await this.billing.artifact(empresaId, publicId, type);
    response.set({
      'Content-Type': file.contentType,
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${file.filename}"`,
      'Content-Length': file.buffer.length,
    });
    return new StreamableFile(file.buffer);
  }

  private empresaId(user: JwtPayload) {
    if (!user.empresaId)
      throw new UnauthorizedException('El usuario no tiene empresa activa');
    return BigInt(user.empresaId);
  }
  private userId(user: JwtPayload) {
    if (!user.sub) throw new UnauthorizedException('Usuario no autenticado');
    return user.sub;
  }
}
