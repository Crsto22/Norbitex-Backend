import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ModuleAccessGuard } from './module-access.guard';

describe('ModuleAccessGuard', () => {
  const buildContext = (user: {
    roles: string[];
    moduleKeys?: string[];
    planStatus?: 'trial' | 'active' | 'expired';
  }) =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    }) as unknown as ExecutionContext;

  it('allows owners only through their effective plan modules', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['reportes-ventas']),
    } as unknown as Reflector;
    const guard = new ModuleAccessGuard(reflector);

    expect(
      guard.canActivate(
        buildContext({
          roles: ['OWNER'],
          moduleKeys: ['reportes-ventas'],
          planStatus: 'active',
        }),
      ),
    ).toBe(true);
  });

  it('allows any assigned module accepted by the endpoint', () => {
    const reflector = {
      getAllAndOverride: jest
        .fn()
        .mockReturnValue(['reportes-productos', 'ventas-pos']),
    } as unknown as Reflector;
    const guard = new ModuleAccessGuard(reflector);

    expect(
      guard.canActivate(
        buildContext({
          roles: [],
          moduleKeys: ['ventas-pos'],
          planStatus: 'active',
        }),
      ),
    ).toBe(true);
  });

  it('rejects a different or missing report module', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['reportes-usuarios']),
    } as unknown as Reflector;
    const guard = new ModuleAccessGuard(reflector);

    expect(() =>
      guard.canActivate(
        buildContext({
          roles: [],
          moduleKeys: ['reportes-clientes'],
          planStatus: 'active',
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('returns the plan expired error before the module error', () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['ventas-pos']),
    } as unknown as Reflector;
    const guard = new ModuleAccessGuard(reflector);

    let thrown: unknown;
    try {
      guard.canActivate(
        buildContext({
          roles: ['OWNER'],
          moduleKeys: [],
          planStatus: 'expired',
        }),
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ForbiddenException);
    if (!(thrown instanceof ForbiddenException)) {
      throw new Error('Expected ForbiddenException');
    }
    expect(thrown.getResponse()).toEqual({
      code: 'PLAN_EXPIRED',
      message: 'La suscripcion esta vencida',
    });
  });
});
