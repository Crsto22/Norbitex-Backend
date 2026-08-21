import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
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
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { FindPurchaseOrdersQueryDto } from './dto/find-purchase-orders-query.dto';
import { FindSuppliersQueryDto } from './dto/find-suppliers-query.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { PurchasesService } from './purchases.service';

@UseGuards(ModuleAccessGuard)
@Controller('purchases')
export class PurchasesController {
  constructor(private readonly purchasesService: PurchasesService) {}

  @Get('suppliers')
  @RequireModule('compras-proveedores', 'compras-ordenes')
  findSuppliers(
    @CurrentUser() user: JwtPayload,
    @Query() query: FindSuppliersQueryDto,
  ) {
    return this.purchasesService.findSuppliers(this.getEmpresaId(user), query);
  }

  @Post('suppliers')
  @RequireModule('compras-proveedores')
  createSupplier(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateSupplierDto,
  ) {
    return this.purchasesService.createSupplier(this.getEmpresaId(user), dto);
  }

  @Patch('suppliers/:id')
  @RequireModule('compras-proveedores')
  updateSupplier(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSupplierDto,
  ) {
    return this.purchasesService.updateSupplier(
      this.getEmpresaId(user),
      BigInt(id),
      dto,
    );
  }

  @Delete('suppliers/:id')
  @RequireModule('compras-proveedores')
  removeSupplier(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.purchasesService.removeSupplier(
      this.getEmpresaId(user),
      BigInt(id),
    );
  }

  @Get('orders')
  @RequireModule('compras-ordenes')
  findOrders(
    @CurrentUser() user: JwtPayload,
    @Query() query: FindPurchaseOrdersQueryDto,
  ) {
    return this.purchasesService.findOrders(
      this.getEmpresaId(user),
      getCommercialScope(user),
      query,
    );
  }

  @Get('orders/:publicId')
  @RequireModule('compras-ordenes')
  findOrder(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ) {
    return this.purchasesService.findOrder(
      this.getEmpresaId(user),
      getCommercialScope(user),
      publicId,
    );
  }

  @Post('orders')
  @RequireModule('compras-ordenes')
  createOrder(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreatePurchaseOrderDto,
  ) {
    return this.purchasesService.createOrder(
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
