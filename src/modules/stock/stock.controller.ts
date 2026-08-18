import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import { getCommercialScope } from '../../common/commercial-access';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { CreateStockMovementDto } from './dto/create-stock-movement.dto';
import { CreateStockTransferDto } from './dto/create-stock-transfer.dto';
import { FindStockKardexQueryDto } from './dto/find-stock-kardex-query.dto';
import { FindStockMovementsQueryDto } from './dto/find-stock-movements-query.dto';
import { FindStockTransfersQueryDto } from './dto/find-stock-transfers-query.dto';
import { StockService } from './stock.service';

@UseGuards(ModuleAccessGuard)
@Controller('stock')
export class StockController {
  constructor(private readonly stockService: StockService) {}

  @Get('locations')
  @RequireModule('stock-movimientos', 'stock-traspasos', 'stock-kardex')
  findLocations(@CurrentUser() user: JwtPayload) {
    return this.stockService.findLocations(
      this.getEmpresaId(user),
      getCommercialScope(user),
    );
  }

  @Get('movements')
  @RequireModule('stock-movimientos')
  findMovements(
    @CurrentUser() user: JwtPayload,
    @Query() query: FindStockMovementsQueryDto,
  ) {
    return this.stockService.findMovements(
      this.getEmpresaId(user),
      getCommercialScope(user),
      query,
    );
  }

  @Post('movements')
  @RequireModule('stock-movimientos')
  createMovement(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateStockMovementDto,
  ) {
    return this.stockService.createMovement(
      this.getEmpresaId(user),
      getCommercialScope(user),
      dto,
    );
  }

  @Get('kardex')
  @RequireModule('stock-kardex')
  findKardex(
    @CurrentUser() user: JwtPayload,
    @Query() query: FindStockKardexQueryDto,
  ) {
    return this.stockService.findKardex(
      this.getEmpresaId(user),
      getCommercialScope(user),
      query,
    );
  }

  @Get('transfers')
  @RequireModule('stock-traspasos')
  findTransfers(
    @CurrentUser() user: JwtPayload,
    @Query() query: FindStockTransfersQueryDto,
  ) {
    return this.stockService.findTransfers(
      this.getEmpresaId(user),
      getCommercialScope(user),
      query,
    );
  }

  @Get('transfers/:publicId')
  @RequireModule('stock-traspasos')
  findTransfer(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ) {
    return this.stockService.findTransfer(
      this.getEmpresaId(user),
      getCommercialScope(user),
      publicId,
    );
  }

  @Post('transfers')
  @RequireModule('stock-traspasos')
  createTransfer(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateStockTransferDto,
  ) {
    return this.stockService.createTransfer(
      this.getEmpresaId(user),
      getCommercialScope(user),
      dto,
    );
  }

  private getEmpresaId(user: JwtPayload) {
    if (!user.empresaId) {
      throw new UnauthorizedException('El usuario no tiene empresa activa');
    }
    return BigInt(user.empresaId);
  }
}
