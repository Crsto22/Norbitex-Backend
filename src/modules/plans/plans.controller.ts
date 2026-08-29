import { Controller, Get, Query, UnauthorizedException } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { PlatformAffiliatesService } from '../platform-admin/platform-affiliates.service';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { PlansService } from './plans.service';

@Controller('plans')
export class PlansController {
  constructor(
    private readonly plansService: PlansService,
    private readonly platformAffiliatesService: PlatformAffiliatesService,
  ) {}

  @Public()
  @Get()
  findAll() {
    return this.plansService.getCatalog();
  }

  @Public()
  @Get('attendance-pricing')
  getAttendancePricing() {
    return this.plansService.getAttendancePricing();
  }

  @Public()
  @Get('affiliate-code')
  validateAffiliateCode(@Query('code') code?: string) {
    return this.platformAffiliatesService.validatePublicCode(code);
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
