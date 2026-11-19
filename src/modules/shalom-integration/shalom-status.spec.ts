import { VentaEnvioEstadoLogistico } from '@prisma/client';

import { toEstadoLogistico } from './shalom-status';

describe('toEstadoLogistico', () => {
  it('mapea los estados del rastreo al flujo logistico', () => {
    expect(toEstadoLogistico('EN_ORIGEN')).toBe(VentaEnvioEstadoLogistico.POR_DESPACHAR);
    expect(toEstadoLogistico('EN_TRANSITO')).toBe(VentaEnvioEstadoLogistico.EN_TRANSITO);
    expect(toEstadoLogistico('ENTREGADO')).toBe(VentaEnvioEstadoLogistico.ENTREGADO);
    expect(toEstadoLogistico('INCIDENCIA')).toBe(VentaEnvioEstadoLogistico.INCIDENCIA);
  });

  it('no altera el estado en registrado o anulado', () => {
    expect(toEstadoLogistico('REGISTRADO')).toBeNull();
    expect(toEstadoLogistico('ANULADO')).toBeNull();
  });
});
