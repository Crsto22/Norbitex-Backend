import { Prisma, VisibilidadOperaciones } from '@prisma/client';
import { SalesService } from './sales.service';

describe('SalesService product catalog', () => {
  it('only returns products and variants with stock in the selected branch', async () => {
    const product = {
      id: 10n,
      empresaId: 1n,
      nombre: 'Polo',
      tipo: 'variantes',
      descripcion: null,
      marca: null,
      categoria: null,
      unidadMedida: { codigo: 'NIU', descripcion: 'Unidad' },
      tipoAfectacionIgv: { codigo: '10', descripcion: 'Gravado' },
      variantes: [
        {
          id: 101n,
          sku: 'POLO-M',
          codigoBarras: null,
          precioVenta: new Prisma.Decimal(20),
          precioMayorista: null,
          tallaId: 1n,
          talla: { id: 1n, nombre: 'M' },
          productoColor: {
            colorId: 1n,
            color: { id: 1n, nombre: 'Negro', hex: '#000000' },
            imagenes: [],
          },
          inventarios: [
            { sucursalId: 5n, stockActual: 3, sucursal: { id: 5n } },
          ],
        },
        {
          id: 102n,
          sku: 'POLO-L',
          codigoBarras: null,
          precioVenta: new Prisma.Decimal(25),
          precioMayorista: null,
          tallaId: 2n,
          talla: { id: 2n, nombre: 'L' },
          productoColor: {
            colorId: 1n,
            color: { id: 1n, nombre: 'Negro', hex: '#000000' },
            imagenes: [],
          },
          inventarios: [],
        },
      ],
    };
    const prisma = {
      producto: {
        findMany: jest.fn().mockResolvedValue([product]),
        count: jest.fn().mockResolvedValue(1),
      },
      $transaction: jest.fn((queries: Promise<unknown>[]) =>
        Promise.all(queries),
      ),
    };
    const service = new SalesService(
      prisma as never,
      { get: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const response = await service.findProducts(
      1n,
      {
        userId: 1n,
        branchId: null,
        visibility: VisibilidadOperaciones.todas,
        isOwner: true,
      },
      { sucursalId: '5' },
    );

    expect(response.meta.total).toBe(1);
    const findManyCall = prisma.producto.findMany.mock.calls[0] as unknown as [
      { where: Prisma.ProductoWhereInput },
    ];
    expect(findManyCall[0].where).toMatchObject({
      variantes: {
        some: {
          inventarios: {
            some: { stockActual: { gt: 0 }, sucursalId: 5n },
          },
        },
      },
    });
    expect(response.data[0]).toMatchObject({
      productoId: '10',
      precioMinimo: '20.00',
      precioMaximo: '20.00',
      stockSucursal: 3,
      cantidadVariantes: 1,
    });
    expect(response.data[0].variantes).toHaveLength(1);
  });
});
