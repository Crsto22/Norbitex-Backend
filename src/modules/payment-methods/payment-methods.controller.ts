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
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { CreatePaymentMethodDto } from './dto/create-payment-method.dto';
import { FindPaymentMethodsQueryDto } from './dto/find-payment-methods-query.dto';
import { UpdatePaymentMethodDto } from './dto/update-payment-method.dto';
import { PaymentMethodsService } from './payment-methods.service';

@UseGuards(JwtAuthGuard)
@Controller('payment-methods')
export class PaymentMethodsController {
  constructor(private readonly paymentMethodsService: PaymentMethodsService) {}

  @Get()
  findAll(@CurrentUser() user: JwtPayload, @Query() query: FindPaymentMethodsQueryDto) {
    return this.paymentMethodsService.findAll(this.getEmpresaId(user), query);
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreatePaymentMethodDto) {
    return this.paymentMethodsService.create(this.getEmpresaId(user), dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePaymentMethodDto,
  ) {
    return this.paymentMethodsService.update(this.getEmpresaId(user), BigInt(id), dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    return this.paymentMethodsService.remove(this.getEmpresaId(user), BigInt(id));
  }

  private getEmpresaId(user: JwtPayload) {
    if (!user.empresaId) {
      throw new UnauthorizedException('El usuario no tiene empresa activa');
    }

    return BigInt(user.empresaId);
  }
}
