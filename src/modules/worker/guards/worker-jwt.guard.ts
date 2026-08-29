import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import type { JwtPayload } from '../../auth/types/jwt-payload.type';

@Injectable()
export class WorkerJwtGuard extends JwtAuthGuard implements CanActivate {
  constructor(reflector: Reflector) {
    super(reflector);
  }

  canActivate(context: ExecutionContext) {
    const result = super.canActivate(context);
    if (result instanceof Promise) {
      return result.then(() => this.ensureWorker(context));
    }
    return result && this.ensureWorker(context);
  }

  private ensureWorker(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{ user?: JwtPayload }>();
    if (request.user?.type !== 'worker') {
      throw new UnauthorizedException('Sesion de trabajador requerida');
    }
    return true;
  }
}
