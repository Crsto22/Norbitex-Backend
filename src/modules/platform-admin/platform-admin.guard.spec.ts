import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PlatformAdminGuard } from './platform-admin.guard';

describe('PlatformAdminGuard', () => {
  const guard = new PlatformAdminGuard();
  const context = (roles: string[]) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ user: { roles } }),
      }),
    }) as unknown as ExecutionContext;

  it('allows only the SUPERADMIN role', () => {
    expect(guard.canActivate(context(['SUPERADMIN']))).toBe(true);
    expect(() => guard.canActivate(context(['OWNER']))).toThrow(
      ForbiddenException,
    );
  });
});
