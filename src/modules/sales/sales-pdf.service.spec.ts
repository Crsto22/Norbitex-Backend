import { Prisma } from '@prisma/client';
import { SalesPdfService } from './sales-pdf.service';

const decimal = (value: number) => new Prisma.Decimal(value);

const sale = {
  empresa: {
    id: 1n,
    nombreComercial: 'Nuvex',
    razonSocial: 'Nuvex S.A.C.',
    ruc: '20123456789',
    direccion: 'Av. Principal 123',
    logoUrl: null,
    logoPdfUrl: null,
    sunatConfig: { ambiente: 'BETA' },
  },
  sucursal: {
    nombre: 'Principal',
    direccion: 'Av. Principal 123',
    distrito: 'Lima',
    ubigeo: '150101',
  },
  cliente: {
    nombre: 'Cliente de prueba',
    razonSocial: null,
    tipoDocumento: 'dni',
    numeroDocumento: '12345678',
    direccion: 'Jr. Prueba 456',
  },
  detalles: [
    {
      cantidad: 2,
      descripcion:
        'Polo de algodon con una descripcion suficientemente extensa para validar el ajuste de lineas',
      unidadMedidaCodigo: 'NIU',
      precioUnitario: decimal(25),
      total: decimal(50),
      productoVariante: {
        sku: 'POL-001',
        producto: { nombre: 'Polo' },
        productoColor: { color: { nombre: 'Negro' } },
        talla: { nombre: 'M' },
      },
    },
  ],
  pagos: [
    {
      monto: decimal(50),
      metodoPago: { nombre: 'Efectivo' },
    },
  ],
  tipoComprobante: 'boleta',
  correlativo: 'B001-000001',
  serie: 'B001',
  numero: 1,
  createdAt: new Date('2026-07-30T16:00:00-05:00'),
  subtotal: decimal(42.37),
  descuentoMonto: decimal(0),
  opGravadas: decimal(42.37),
  opExoneradas: decimal(0),
  opInafectas: decimal(0),
  igvPorcentaje: decimal(18),
  igvMonto: decimal(7.63),
  total: decimal(50),
  observaciones: 'Documento generado durante la prueba.',
  sunatCodigo: null,
  sunatHash: 'HASH-DE-PRUEBA',
  sunatEstado: 'aceptado',
};

describe('SalesPdfService', () => {
  const prisma = {
    venta: { findFirst: jest.fn() },
    empresa: { update: jest.fn() },
  };
  const logoStorage = {
    resolveToDataUri: jest.fn().mockResolvedValue(null),
    saveCompanyLogoFromUrl: jest.fn(),
  };
  const service = new SalesPdfService(prisma as never, logoStorage as never);

  beforeEach(() => {
    prisma.venta.findFirst.mockResolvedValue(sale);
  });

  it('genera el PDF A4 de venta directamente', async () => {
    const pdf = await service.generateSalePdf(1n, 'venta-prueba');
    const source = pdf.toString('latin1');

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(source).toContain('/MediaBox [0 0 595.28 841.89]');
  });

  it('genera un ticket de 80 mm con altura dinamica', async () => {
    const pdf = await service.generateSaleTicketPdf(1n, 'venta-prueba');
    const source = pdf.toString('latin1');

    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(source).toMatch(/\/MediaBox \[0 0 226\.77\d* \d+(\.\d+)?\]/);
  });
});
