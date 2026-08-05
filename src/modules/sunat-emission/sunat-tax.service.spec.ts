import { Prisma, VentaTipoComprobante } from '@prisma/client';
import { SunatTaxService } from './sunat-tax.service';

describe('SunatTaxService', () => {
  const service = new SunatTaxService();

  it('calcula IGV con precios incluidos', () => {
    const result = service.calculate({
      tipoComprobante: VentaTipoComprobante.factura,
      igvPorcentaje: new Prisma.Decimal(18),
      lines: [
        {
          productoVarianteId: 1n,
          cantidad: 1,
          precioUnitario: new Prisma.Decimal(118),
          descuentoTipo: null,
          descuentoValor: null,
          descripcion: 'Polo',
          unidadMedidaCodigo: 'NIU',
          tipoAfectacionIgvCodigo: '10',
        },
      ],
    });

    expect(result.opGravadas.toFixed(2)).toBe('100.00');
    expect(result.igvMonto.toFixed(2)).toBe('18.00');
    expect(result.total.toFixed(2)).toBe('118.00');
  });

  it('prorratea descuento global dejando redondeo en la ultima linea', () => {
    const result = service.calculate({
      tipoComprobante: VentaTipoComprobante.boleta,
      igvPorcentaje: new Prisma.Decimal(18),
      descuentoTipo: 'monto',
      descuentoValor: new Prisma.Decimal(10),
      lines: [
        {
          productoVarianteId: 1n,
          cantidad: 1,
          precioUnitario: new Prisma.Decimal(33.33),
          descuentoTipo: null,
          descuentoValor: null,
          descripcion: 'A',
          unidadMedidaCodigo: 'NIU',
          tipoAfectacionIgvCodigo: '10',
        },
        {
          productoVarianteId: 2n,
          cantidad: 1,
          precioUnitario: new Prisma.Decimal(66.67),
          descuentoTipo: null,
          descuentoValor: null,
          descripcion: 'B',
          unidadMedidaCodigo: 'NIU',
          tipoAfectacionIgvCodigo: '10',
        },
      ],
    });

    const lineDiscountTotal = result.lines.reduce(
      (sum, line) => sum.add(line.descuentoMonto),
      new Prisma.Decimal(0),
    );

    expect(lineDiscountTotal.toFixed(2)).toBe('10.00');
    expect(result.total.toFixed(2)).toBe('90.00');
  });

  it('rechaza descuento por item en factura y boleta', () => {
    expect(() =>
      service.calculate({
        tipoComprobante: VentaTipoComprobante.factura,
        igvPorcentaje: new Prisma.Decimal(18),
        lines: [
          {
            productoVarianteId: 1n,
            cantidad: 1,
            precioUnitario: new Prisma.Decimal(100),
            descuentoTipo: 'monto',
            descuentoValor: new Prisma.Decimal(1),
            descripcion: 'Polo',
            unidadMedidaCodigo: 'NIU',
            tipoAfectacionIgvCodigo: '10',
          },
        ],
      }),
    ).toThrow('Para facturas y boletas use solo descuento global');
  });
});
