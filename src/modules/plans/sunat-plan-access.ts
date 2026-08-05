import { ForbiddenException } from '@nestjs/common';
import { PlanCodigo, SunatAmbiente } from '@prisma/client';

export function assertSunatEnvironmentAllowed(
  planCode: PlanCodigo,
  environment: SunatAmbiente,
) {
  if (
    planCode === PlanCodigo.prueba &&
    environment === SunatAmbiente.PRODUCCION
  ) {
    throw new ForbiddenException({
      code: 'SUNAT_PRODUCTION_NOT_INCLUDED',
      message:
        'La prueba gratuita solo permite comprobantes SUNAT en ambiente BETA. Actualiza tu plan para emitir en PRODUCCION.',
    });
  }
}
