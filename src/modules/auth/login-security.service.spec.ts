import { UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LoginSecurityService } from './login-security.service';
import { TurnstileService } from './turnstile.service';

describe('LoginSecurityService', () => {
  it('requires Turnstile when three failures are active', async () => {
    const service = new LoginSecurityService(
      {
        loginIntento: { findFirst: jest.fn().mockResolvedValue({ id: 1n }) },
      } as unknown as PrismaService,
      { verify: jest.fn() } as unknown as TurnstileService,
    );

    await expect(
      service.enforce('user@example.com', '127.0.0.1'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
