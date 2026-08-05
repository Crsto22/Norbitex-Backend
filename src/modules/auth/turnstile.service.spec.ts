import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TurnstileService } from './turnstile.service';

describe('TurnstileService', () => {
  const service = new TurnstileService(
    new ConfigService({ TURNSTILE_SECRET_KEY: 'secret' }),
  );

  afterEach(() => jest.restoreAllMocks());

  it('accepts only a successful token for the expected action', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      json: () => Promise.resolve({ success: true, action: 'register' }),
    } as Response);

    await expect(service.verify('token', 'register')).resolves.toBeUndefined();
    await expect(
      service.verify('token', 'forgot_password'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
