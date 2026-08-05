import { VentaTipoComprobante } from '@prisma/client';
import {
  buildSunatFileBase,
  isCreditNoteType,
  sunatFolder,
} from './sunat-comprobante.helper';

describe('sunat credit note helpers', () => {
  it('uses SUNAT document code 07 and credit-note folder', () => {
    expect(isCreditNoteType(VentaTipoComprobante.nota_credito_factura)).toBe(
      true,
    );
    expect(sunatFolder(VentaTipoComprobante.nota_credito_boleta)).toBe(
      'notas-credito',
    );
    expect(
      buildSunatFileBase({
        ruc: '20123456789',
        tipoComprobante: VentaTipoComprobante.nota_credito_factura,
        serie: 'F001',
        numero: 12,
      }),
    ).toBe('20123456789-07-F001-00000012');
  });
});
