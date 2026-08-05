import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { requiredModuleKey } from '../decorators/require-module.decorator';
import type { JwtPayload } from '../../modules/auth/types/jwt-payload.type';

@Injectable()
export class ModuleAccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const moduleKeys = this.reflector.getAllAndOverride<string[]>(
      requiredModuleKey,
      [context.getHandler(), context.getClass()],
    );

    if (!moduleKeys?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as JwtPayload | undefined;

    if (user?.moduleKeys?.some((moduleKey) => moduleKeys.includes(moduleKey))) {
      return true;
    }

    if (user?.planStatus === 'expired') {
      throw new ForbiddenException({
        code: 'PLAN_EXPIRED',
        message: 'La suscripcion esta vencida',
      });
    }

    throw new ForbiddenException({
      code: 'MODULE_NOT_INCLUDED',
      message: 'No tienes acceso a este modulo',
    });
  }
}
