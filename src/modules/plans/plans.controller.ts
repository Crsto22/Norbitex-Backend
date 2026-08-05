import { Controller, Get, UnauthorizedException } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { PlansService } from './plans.service';

@Controller('plans')
export class PlansController {
  constructor(private readonly plansService: PlansService) {}

  @Public()
  @Get()
  findAll() {
    return this.plansService.getCatalog();
  }
  @Get('current')
  findCurrent(@CurrentUser() user: JwtPayload) {
    if (!user.empresaId) {
      throw new UnauthorizedException('El usuario no tiene empresa activa');
    }

    return this.plansService.getCurrent(
      BigInt(user.empresaId),
      user.moduleKeys ?? [],
    );
  }
}
