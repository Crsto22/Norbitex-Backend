import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  it('permite rutas declaradas como publicas', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(true),
    } as unknown as Reflector;
    const guard = new JwtAuthGuard(reflector);

    expect(
      guard.canActivate({
        getHandler: jest.fn(),
        getClass: jest.fn(),
      } as unknown as ExecutionContext),
    ).toBe(true);
  });
});
