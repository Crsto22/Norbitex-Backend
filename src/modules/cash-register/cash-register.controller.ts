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
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { CashRegisterService } from './cash-register.service';
import { CloseCashRegisterDto } from './dto/close-cash-register.dto';
import { CreateCashMovementDto } from './dto/create-cash-movement.dto';
import {
  FindCashRegisterQueryDto,
  FindCurrentCashRegisterQueryDto,
} from './dto/find-cash-register-query.dto';
import { OpenCashRegisterDto } from './dto/open-cash-register.dto';

@UseGuards(JwtAuthGuard)
@Controller('cash-register')
export class CashRegisterController {
  constructor(private readonly cashRegisterService: CashRegisterService) {}

  @Post('open')
  open(@CurrentUser() user: JwtPayload, @Body() dto: OpenCashRegisterDto) {
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
    return this.cashRegisterService.createMovement(
      this.getEmpresaId(user),
      this.getUserId(user),
      dto,
    );
  }

  @Post('close')
  close(@CurrentUser() user: JwtPayload, @Body() dto: CloseCashRegisterDto) {
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
    return this.cashRegisterService.findAll(this.getEmpresaId(user), query);
  }

  @Get(':publicId')
  findOne(@CurrentUser() user: JwtPayload, @Param('publicId') publicId: string) {
    return this.cashRegisterService.findOne(this.getEmpresaId(user), publicId);
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
