import { ForbiddenException } from '@nestjs/common';
import { PlanCodigo, SunatAmbiente } from '@prisma/client';
import { assertSunatEnvironmentAllowed } from './sunat-plan-access';

describe('assertSunatEnvironmentAllowed', () => {
  it('allows trial tests in BETA and blocks PRODUCCION', () => {
    expect(() =>
      assertSunatEnvironmentAllowed(PlanCodigo.prueba, SunatAmbiente.BETA),
    ).not.toThrow();
    expect(() =>
      assertSunatEnvironmentAllowed(
        PlanCodigo.prueba,
        SunatAmbiente.PRODUCCION,
      ),
    ).toThrow(ForbiddenException);
  });
});
