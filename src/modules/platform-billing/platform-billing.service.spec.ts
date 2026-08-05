import {
  PlataformaComprobanteTipo,
  Prisma,
  SunatBajaTipo,
} from '@prisma/client';
import {
  calculateIncludedTax,
  platformCancellationType,
} from './platform-billing.service';

describe('calculateIncludedTax', () => {
  it('separa IGV incluido sin cambiar el total', () => {
    const result = calculateIncludedTax(
      new Prisma.Decimal('118.00'),
      new Prisma.Decimal('18'),
    );

    expect(result.base.toFixed(2)).toBe('100.00');
    expect(result.igv.toFixed(2)).toBe('18.00');
    expect(result.base.add(result.igv).toFixed(2)).toBe('118.00');
  });
});

describe('platformCancellationType', () => {
  it('usa RA para factura, RC para boleta y ninguna baja para nota de venta', () => {
    expect(platformCancellationType(PlataformaComprobanteTipo.factura)).toBe(
      SunatBajaTipo.RA,
    );
    expect(platformCancellationType(PlataformaComprobanteTipo.boleta)).toBe(
      SunatBajaTipo.RC,
    );
    expect(
      platformCancellationType(PlataformaComprobanteTipo.nota_venta),
    ).toBeNull();
  });
});
