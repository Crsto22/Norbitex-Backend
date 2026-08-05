import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  getCommercialScope,
  scopedCreatorId,
} from '../../../common/commercial-access';
import { PrismaService } from '../../../prisma/prisma.service';
import type { JwtPayload } from '../../auth/types/jwt-payload.type';

@Injectable()
export class GuiaScopeGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user: JwtPayload }>();
    const publicId = request.params.publicId;
    if (!publicId) return true;
    if (Array.isArray(publicId)) {
      throw new NotFoundException('Guia de remision no encontrada');
    }
    const scope = getCommercialScope(request.user);
    const guia = await this.prisma.guiaRemision.findFirst({
      where: {
        publicId,
        empresaId: BigInt(request.user.empresaId!),
        ...(scope.branchId ? { sucursalId: scope.branchId } : {}),
        ...(scopedCreatorId(scope)
          ? { creadoPorId: scopedCreatorId(scope)! }
          : {}),
      },
      select: { id: true },
    });
    if (!guia) throw new NotFoundException('Guia de remision no encontrada');
    return true;
  }
}
