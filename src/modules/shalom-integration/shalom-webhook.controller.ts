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
import { ShalomWebhookService } from './shalom-webhook.service';

@Public()
@Controller('shalom/webhooks')
export class ShalomWebhookController {
  constructor(private readonly webhooks: ShalomWebhookService) {}

  @Post()
  @HttpCode(200)
  receive(
    @Req() request: RawBodyRequest<Request>,
    @Headers('x-shalom-signature') signature?: string,
  ) {
    if (!request.rawBody) {
      throw new BadRequestException('No se pudo verificar el cuerpo original');
    }
    if (!signature) {
      throw new UnauthorizedException('Falta X-Shalom-Signature');
    }

    return this.webhooks.receive({
      rawBody: request.rawBody,
      signature,
      payload: request.body as unknown,
    });
  }
}
