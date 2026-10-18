import {
  ClienteTipoDocumento,
  Prisma,
  VentaFormaPago,
  VentaTipoComprobante,
} from '@prisma/client';
import { SunatXmlBuilderService } from './sunat-xml-builder.service';

const decimal = (value: string | number) => new Prisma.Decimal(value);

function sale(type: VentaTipoComprobante, credit: boolean) {
  return {
    id: 1n,
    empresaId: 1n,
    sucursalId: 1n,
    clienteId: 1n,
    tipoComprobante: type,
    serie: type === VentaTipoComprobante.factura ? 'F001' : 'B001',
    numero: 1,
    correlativo: `${type === VentaTipoComprobante.factura ? 'F001' : 'B001'}-000001`,
    moneda: 'PEN',
    formaPago: credit ? VentaFormaPago.CREDITO : VentaFormaPago.CONTADO,
    total: decimal(100),
    subtotal: decimal('84.75'),
    descuentoMonto: decimal(0),
    opGravadas: decimal('84.75'),
    opExoneradas: decimal(0),
    opInafectas: decimal(0),
    igvMonto: decimal('15.25'),
    igvPorcentaje: decimal(18),
    createdAt: new Date('2026-10-18T12:00:00.000Z'),
    empresa: {
      ruc: '20123456789',
      razonSocial: 'Nuvex SAC',
      nombreComercial: 'Nuvex',
      direccion: 'Lima',
    },
    sucursal: {
      codigoEstablecimientoSunat: '0000',
      direccion: 'Lima',
      ubigeo: '150101',
    },
    cliente: {
      tipoDocumento: ClienteTipoDocumento.ruc,
      numeroDocumento: '20987654321',
      razonSocial: 'Cliente SAC',
      nombre: null,
    },
    cuentaPorCobrar: credit
      ? {
          saldoInicial: decimal(80),
          cuotas: [
            {
              numero: 1,
              montoOriginal: decimal(40),
              fechaVencimiento: new Date('2026-11-18T00:00:00.000Z'),
            },
            {
              numero: 2,
              montoOriginal: decimal(40),
              fechaVencimiento: new Date('2026-12-18T00:00:00.000Z'),
            },
          ],
        }
      : null,
    detalles: [
      {
        cantidad: 1,
        unidadMedidaCodigo: 'NIU',
        tipoAfectacionIgvCodigo: '10',
        valorUnitario: decimal('84.7457627119'),
        precioUnitario: decimal(100),
        valorVenta: decimal('84.75'),
        igvMonto: decimal('15.25'),
        total: decimal(100),
        productoVariante: { producto: { nombre: 'Producto' } },
      },
    ],
  };
}

describe('SunatXmlBuilderService payment terms', () => {
  const service = new SunatXmlBuilderService();

  it('incluye saldo y cuotas en una factura al credito', () => {
    const xml = service.build(
      sale(VentaTipoComprobante.factura, true) as never,
    );

    expect(xml).toContain('<cbc:PaymentMeansID>Credito</cbc:PaymentMeansID>');
    expect(xml).toContain('<cbc:Amount currencyID="PEN">80.00</cbc:Amount>');
    expect(xml).toContain('<cbc:PaymentMeansID>Cuota001</cbc:PaymentMeansID>');
    expect(xml).toContain(
      '<cbc:PaymentDueDate>2026-11-18</cbc:PaymentDueDate>',
    );
    expect(xml).toContain('<cbc:PaymentMeansID>Cuota002</cbc:PaymentMeansID>');
  });

  it('no envia cronograma tributario en una boleta al credito', () => {
    const xml = service.build(sale(VentaTipoComprobante.boleta, true) as never);

    expect(xml).not.toContain(
      '<cbc:PaymentMeansID>Credito</cbc:PaymentMeansID>',
    );
    expect(xml).not.toContain('Cuota001');
  });
});
