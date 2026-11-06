import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { rateLimits } from '../../common/rate-limits';
import { SubmitShippingDetailsDto } from './dto/submit-shipping-details.dto';
import { ShippingLinksService } from './shipping-links.service';

@Public()
@Throttle(rateLimits.shippingLinks)
@Controller('public/shipping-links')
export class PublicShippingLinksController {
  constructor(private readonly shippingLinksService: ShippingLinksService) {}

  @Get(':code')
  findOne(@Param('code') code: string) {
    return this.shippingLinksService.getPublic(code);
  }

  @Post(':code')
  submit(@Param('code') code: string, @Body() dto: SubmitShippingDetailsDto) {
    return this.shippingLinksService.submitPublic(code, dto);
  }
}
