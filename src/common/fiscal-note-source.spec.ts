import { SunatBajaEstado, VentaEstado } from '@prisma/client';
import { isFiscalNoteSourceUnavailable } from './fiscal-note-source';

describe('fiscal note source availability', () => {
  it.each([
    SunatBajaEstado.pendiente_envio,
    SunatBajaEstado.enviando,
    SunatBajaEstado.pendiente_cdr,
    SunatBajaEstado.aceptado,
    SunatBajaEstado.observado,
    SunatBajaEstado.error_transitorio,
  ])('blocks a source with void status %s', (sunatBajaEstado) => {
    expect(
      isFiscalNoteSourceUnavailable({
        estado: VentaEstado.completada,
        sunatBajaEstado,
      }),
    ).toBe(true);
  });

  it.each([
    null,
    SunatBajaEstado.no_aplica,
    SunatBajaEstado.rechazado,
    SunatBajaEstado.error_definitivo,
  ])('allows a current source with void status %s', (sunatBajaEstado) => {
    expect(
      isFiscalNoteSourceUnavailable({
        estado: VentaEstado.completada,
        sunatBajaEstado,
      }),
    ).toBe(false);
  });

  it('blocks a commercially annulled sale even without a void status', () => {
    expect(
      isFiscalNoteSourceUnavailable({
        estado: VentaEstado.anulada,
        sunatBajaEstado: null,
      }),
    ).toBe(true);
  });
});
