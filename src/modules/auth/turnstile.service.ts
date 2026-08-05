import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type TurnstileResponse = {
  success: boolean;
  action?: string;
};

@Injectable()
export class TurnstileService {
  constructor(private readonly configService: ConfigService) {}

  async verify(token: string, expectedAction: string, remoteIp?: string) {
    const secret = this.configService.get<string>('TURNSTILE_SECRET_KEY');
    if (!secret) {
      throw new ServiceUnavailableException('Turnstile no esta configurado');
    }

    let result: TurnstileResponse;
    try {
      const response = await fetch(
        'https://challenges.cloudflare.com/turnstile/v0/siteverify',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            secret,
            response: token,
            ...(remoteIp ? { remoteip: remoteIp } : {}),
          }),
          signal: AbortSignal.timeout(5_000),
        },
      );
      result = (await response.json()) as TurnstileResponse;
    } catch {
      throw new ServiceUnavailableException(
        'No se pudo validar Turnstile. Intenta nuevamente.',
      );
    }

    if (!result.success || result.action !== expectedAction) {
      throw new BadRequestException({
        code: 'TURNSTILE_INVALID',
        message: 'La verificacion de seguridad expiro o no es valida.',
      });
    }
  }
}
