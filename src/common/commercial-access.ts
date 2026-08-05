import { ForbiddenException } from '@nestjs/common';
import { VisibilidadOperaciones } from '@prisma/client';
import type { JwtPayload } from '../modules/auth/types/jwt-payload.type';

export type CommercialScope = {
  userId: bigint;
  branchId: bigint | null;
  visibility: VisibilidadOperaciones;
  isOwner: boolean;
};

export function getCommercialScope(user: JwtPayload): CommercialScope {
  const isOwner = user.roles.includes('OWNER');
  return {
    userId: BigInt(user.sub),
    branchId: isOwner || !user.sucursalId ? null : BigInt(user.sucursalId),
    visibility: isOwner
      ? VisibilidadOperaciones.todas
      : (user.visibilidadOperaciones ?? VisibilidadOperaciones.todas),
    isOwner,
  };
}

export function resolveScopedBranchId(
  scope: CommercialScope,
  requestedId?: string | null,
) {
  if (scope.branchId) {
    if (
      requestedId &&
      requestedId !== 'all' &&
      BigInt(requestedId) !== scope.branchId
    ) {
      throw new ForbiddenException({
        code: 'BRANCH_ACCESS_DENIED',
        message: 'No tienes acceso a esta sucursal',
      });
    }
    return scope.branchId;
  }

  return requestedId && requestedId !== 'all' ? BigInt(requestedId) : null;
}

export function scopedCreatorId(scope: CommercialScope) {
  return scope.visibility === VisibilidadOperaciones.propias
    ? scope.userId
    : null;
}
