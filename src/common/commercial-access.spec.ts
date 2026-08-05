import { ForbiddenException } from '@nestjs/common';
import { VisibilidadOperaciones } from '@prisma/client';
import { resolveScopedBranchId, scopedCreatorId } from './commercial-access';

describe('commercial access', () => {
  const scope = {
    userId: 8n,
    branchId: 3n,
    visibility: VisibilidadOperaciones.propias,
    isOwner: false,
  };

  it('forces the assigned branch and own creator', () => {
    expect(resolveScopedBranchId(scope)).toBe(3n);
    expect(scopedCreatorId(scope)).toBe(8n);
  });

  it('rejects another branch', () => {
    expect(() => resolveScopedBranchId(scope, '4')).toThrow(ForbiddenException);
  });
});
