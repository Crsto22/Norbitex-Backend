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
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import {
  getCommercialScope,
  resolveScopedBranchId,
  scopedCreatorId,
} from '../../common/commercial-access';
import { CashRegisterService } from './cash-register.service';
import { CloseCashRegisterDto } from './dto/close-cash-register.dto';
import { CreateCashMovementDto } from './dto/create-cash-movement.dto';
import {
  FindCashRegisterQueryDto,
  FindCurrentCashRegisterQueryDto,
} from './dto/find-cash-register-query.dto';
import { OpenCashRegisterDto } from './dto/open-cash-register.dto';

@UseGuards(ModuleAccessGuard)
@RequireModule('caja')
@Controller('cash-register')
export class CashRegisterController {
  constructor(private readonly cashRegisterService: CashRegisterService) {}

  @Post('open')
  open(@CurrentUser() user: JwtPayload, @Body() dto: OpenCashRegisterDto) {
    dto.sucursalId = resolveScopedBranchId(
      getCommercialScope(user),
      dto.sucursalId,
    )!.toString();
    return this.cashRegisterService.open(
      this.getEmpresaId(user),
      this.getUserId(user),
      dto,
    );
  }

  @Get('current')
  current(
    @CurrentUser() user: JwtPayload,
    @Query() query: FindCurrentCashRegisterQueryDto,
  ) {
    query.sucursalId = resolveScopedBranchId(
      getCommercialScope(user),
      query.sucursalId,
    )!.toString();
    return this.cashRegisterService.current(
      this.getEmpresaId(user),
      this.getUserId(user),
      query,
    );
  }

  @Post('movements')
  createMovement(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateCashMovementDto,
  ) {
    dto.sucursalId = resolveScopedBranchId(
      getCommercialScope(user),
      dto.sucursalId,
    )!.toString();
    return this.cashRegisterService.createMovement(
      this.getEmpresaId(user),
      this.getUserId(user),
      dto,
    );
  }

  @Post('close')
  close(@CurrentUser() user: JwtPayload, @Body() dto: CloseCashRegisterDto) {
    dto.sucursalId = resolveScopedBranchId(
      getCommercialScope(user),
      dto.sucursalId,
    )!.toString();
    return this.cashRegisterService.close(
      this.getEmpresaId(user),
      this.getUserId(user),
      dto,
    );
  }

  @Get()
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query() query: FindCashRegisterQueryDto,
  ) {
    const scope = getCommercialScope(user);
    query.sucursalId = resolveScopedBranchId(
      scope,
      query.sucursalId,
    )?.toString();
    query.usuarioId = scopedCreatorId(scope)?.toString() ?? query.usuarioId;
    return this.cashRegisterService.findAll(this.getEmpresaId(user), query);
  }

  @Get(':publicId')
  findOne(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ) {
    return this.cashRegisterService.findOne(
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

    return BigInt(user.sub);
  }
}
