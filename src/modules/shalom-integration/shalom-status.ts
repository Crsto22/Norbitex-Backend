import { VentaEnvioEstadoLogistico } from '@prisma/client';

export type ShalomRemoteStatus =
  | 'REGISTRADO'
  | 'EN_ORIGEN'
  | 'EN_TRANSITO'
  | 'ENTREGADO'
  | 'INCIDENCIA'
  | 'ANULADO';

/**
 * Traduce el estado del rastreo (shalom-service) al estado logistico de Nuvex.
 * `null` cuando el cambio no afecta el flujo interno (registrado/anulado).
 */
export function toEstadoLogistico(
  status: ShalomRemoteStatus,
): VentaEnvioEstadoLogistico | null {
  switch (status) {
    case 'EN_ORIGEN':
      return VentaEnvioEstadoLogistico.POR_DESPACHAR;
    case 'EN_TRANSITO':
      return VentaEnvioEstadoLogistico.EN_TRANSITO;
    case 'ENTREGADO':
      return VentaEnvioEstadoLogistico.ENTREGADO;
    case 'INCIDENCIA':
      return VentaEnvioEstadoLogistico.INCIDENCIA;
    default:
      return null;
  }
}
