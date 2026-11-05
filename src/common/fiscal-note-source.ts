import { Prisma, SunatBajaEstado, VentaEstado } from '@prisma/client';

export const BLOCKING_VOID_STATES = [
  SunatBajaEstado.pendiente_envio,
  SunatBajaEstado.enviando,
  SunatBajaEstado.pendiente_cdr,
  SunatBajaEstado.aceptado,
  SunatBajaEstado.observado,
  SunatBajaEstado.error_transitorio,
] as const;

export const availableFiscalNoteSourceWhere: Prisma.VentaWhereInput = {
  estado: { not: VentaEstado.anulada },
  OR: [
    { sunatBajaEstado: null },
    {
      sunatBajaEstado: {
        in: [
          SunatBajaEstado.no_aplica,
          SunatBajaEstado.rechazado,
          SunatBajaEstado.error_definitivo,
        ],
      },
    },
  ],
};

export function isFiscalNoteSourceUnavailable(source: {
  estado: VentaEstado;
  sunatBajaEstado: SunatBajaEstado | null;
}) {
  return (
    source.estado === VentaEstado.anulada ||
    (source.sunatBajaEstado !== null &&
      BLOCKING_VOID_STATES.includes(
        source.sunatBajaEstado as (typeof BLOCKING_VOID_STATES)[number],
      ))
  );
}
