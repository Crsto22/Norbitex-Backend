import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import type { JwtPayload } from '../auth/types/jwt-payload.type';

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as JwtPayload | undefined;

    if (user?.roles.includes('SUPERADMIN')) {
      return true;
    }

    throw new ForbiddenException({
      code: 'PLATFORM_ADMIN_REQUIRED',
      message: 'Se requiere acceso de super administrador',
    });
  }
}
