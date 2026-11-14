import {
  Controller,
  Get,
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
import { rateLimits } from '../../common/rate-limits';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { getCommercialScope } from '../../common/commercial-access';
import { FindReportQueryDto } from './dto/find-report-query.dto';
import { ReportsService } from './reports.service';

@UseGuards(ModuleAccessGuard)
@Throttle(rateLimits.reports)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('sales')
  @RequireModule('reportes-ventas')
  findSales(
    @CurrentUser() user: JwtPayload,
    @Query() query: FindReportQueryDto,
  ) {
    return this.reportsService.findSales(
      this.getEmpresaId(user),
      getCommercialScope(user),
      query,
    );
  }

  @Get('sales/excel')
  @RequireModule('reportes-ventas')
  async exportSales(
    @CurrentUser() user: JwtPayload,
    @Query() query: FindReportQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.reportsService.exportSalesExcel(
      this.getEmpresaId(user),
      getCommercialScope(user),
      query,
    );

    response.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${file.fileName}"`,
      'Content-Length': file.buffer.length,
    });

    return new StreamableFile(file.buffer);
  }

  @Get('products/csv')
  @RequireModule('reportes-productos')
  async exportProducts(
    @CurrentUser() user: JwtPayload,
    @Query() query: FindReportQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.reportsService.exportProductsCsv(
      this.getEmpresaId(user),
      getCommercialScope(user),
      query,
    );

    response.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${file.fileName}"`,
      'Content-Length': file.buffer.length,
    });

    return new StreamableFile(file.buffer);
  }

  @Get('products')
  @RequireModule('reportes-productos')
  findProducts(
    @CurrentUser() user: JwtPayload,
    @Query() query: FindReportQueryDto,
  ) {
    return this.reportsService.findProducts(
      this.getEmpresaId(user),
      getCommercialScope(user),
      query,
    );
  }

  @Get('clients/csv')
  @RequireModule('reportes-clientes')
  async exportClients(
    @CurrentUser() user: JwtPayload,
    @Query() query: FindReportQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.reportsService.exportClientsCsv(
      this.getEmpresaId(user),
      getCommercialScope(user),
      query,
    );

    response.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${file.fileName}"`,
      'Content-Length': file.buffer.length,
    });

    return new StreamableFile(file.buffer);
  }

  @Get('clients')
  @RequireModule('reportes-clientes')
  findClients(
    @CurrentUser() user: JwtPayload,
    @Query() query: FindReportQueryDto,
  ) {
    return this.reportsService.findClients(
      this.getEmpresaId(user),
      getCommercialScope(user),
      query,
    );
  }

  @Get('users/csv')
  @RequireModule('reportes-usuarios')
  async exportUsers(
    @CurrentUser() user: JwtPayload,
    @Query() query: FindReportQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.reportsService.exportUsersCsv(
      this.getEmpresaId(user),
      getCommercialScope(user),
      query,
    );

    response.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${file.fileName}"`,
      'Content-Length': file.buffer.length,
    });

    return new StreamableFile(file.buffer);
  }

  @Get('users')
  @RequireModule('reportes-usuarios')
  findUsers(
    @CurrentUser() user: JwtPayload,
    @Query() query: FindReportQueryDto,
  ) {
    return this.reportsService.findUsers(
      this.getEmpresaId(user),
      getCommercialScope(user),
      query,
    );
  }

  private getEmpresaId(user: JwtPayload) {
    if (!user.empresaId) {
      throw new UnauthorizedException('El usuario no tiene empresa activa');
    }

    return BigInt(user.empresaId);
  }
}
