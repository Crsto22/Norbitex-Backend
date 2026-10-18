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
import { AccountsReceivableService } from './accounts-receivable.service';
import {
  AnnulReceivablePaymentDto,
  FindAccountsReceivableQueryDto,
  RegisterReceivablePaymentDto,
} from './dto/accounts-receivable.dto';

@UseGuards(ModuleAccessGuard)
@RequireModule('cuentas-cobrar')
@Controller('accounts-receivable')
export class AccountsReceivableController {
  constructor(private readonly service: AccountsReceivableService) {}

  @Get('summary')
  summary(@CurrentUser() user: JwtPayload) {
    return this.service.summary(
      this.getEmpresaId(user),
      getCommercialScope(user),
    );
  }

  @Get()
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query() query: FindAccountsReceivableQueryDto,
  ) {
    return this.service.findAll(
      this.getEmpresaId(user),
      getCommercialScope(user),
      query,
    );
  }

  @Get(':publicId')
  findOne(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
  ) {
    return this.service.findOne(
      this.getEmpresaId(user),
      getCommercialScope(user),
      publicId,
    );
  }

  @Post(':publicId/payments')
  registerPayment(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Body() dto: RegisterReceivablePaymentDto,
  ) {
    return this.service.registerPayment(
      this.getEmpresaId(user),
      getCommercialScope(user),
      publicId,
      dto,
    );
  }

  @Post('payments/:publicId/annul')
  annulPayment(
    @CurrentUser() user: JwtPayload,
    @Param('publicId') publicId: string,
    @Body() dto: AnnulReceivablePaymentDto,
  ) {
    return this.service.annulPayment(
      this.getEmpresaId(user),
      getCommercialScope(user),
      publicId,
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
