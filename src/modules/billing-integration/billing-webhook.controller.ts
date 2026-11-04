import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { BillingWebhookService } from './billing-webhook.service';

@Public()
@Controller('billing/webhooks')
export class BillingWebhookController {
  constructor(private readonly webhooks: BillingWebhookService) {}

  @Post()
  @HttpCode(200)
  receive(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-nuvex-event-id') eventId?: string,
    @Headers('x-nuvex-event') eventType?: string,
    @Headers('x-nuvex-timestamp') timestamp?: string,
    @Headers('x-nuvex-signature') signature?: string,
  ) {
    if (!request.rawBody) {
      throw new BadRequestException('No se pudo verificar el cuerpo original');
    }
    if (!eventId || !eventType || !timestamp || !signature) {
      throw new UnauthorizedException('Cabeceras webhook incompletas');
    }
    return this.webhooks.receive({
      eventId,
      eventType,
      timestamp,
      signature,
      rawBody: request.rawBody,
      payload: request.body as unknown,
    });
  }
}
