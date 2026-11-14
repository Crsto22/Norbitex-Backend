import { NotFoundException } from '@nestjs/common';
import { Prisma, SucursalTipo, VisibilidadOperaciones } from '@prisma/client';
import ExcelJS from 'exceljs';
import { ResponseCacheService } from '../../common/cache/response-cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ReportsService } from './reports.service';

describe('ReportsService', () => {
  const fullScope = {
    userId: 1n,
    branchId: null,
    visibility: VisibilidadOperaciones.todas,
    isOwner: false,
  };
  const passthroughCache = {
    getOrSet: (_key: string, _ttl: number, factory: () => unknown) => factory(),
    key: (...parts: unknown[]) => parts.join(':'),
  } as unknown as ResponseCacheService;

  it('rejects a branch that does not belong to the authenticated company', async () => {
    const findBranch = jest.fn().mockResolvedValue(null);
    const prisma = {
      sucursal: {
        findFirst: findBranch,
      },
    } as unknown as PrismaService;
    const service = new ReportsService(prisma, passthroughCache);

    await expect(
      service.findSales(9n, fullScope, {
        sucursalId: '44',
        dateFilter: 'today',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(findBranch).toHaveBeenCalledWith({
      where: { id: 44n, empresaId: 9n, tipo: SucursalTipo.tienda },
      select: { id: true },
    });
  });

  it('calculates recurrence and excludes unidentified sales', async () => {
    const groupSalesByClient = jest.fn().mockResolvedValue([
      {
        clienteId: 10n,
        _count: { _all: 2 },
        _sum: { total: new Prisma.Decimal(180) },
      },
      {
        clienteId: 11n,
        _count: { _all: 1 },
        _sum: { total: new Prisma.Decimal(90) },
      },
      {
        clienteId: null,
        _count: { _all: 4 },
        _sum: { total: new Prisma.Decimal(400) },
      },
    ]);
    const prisma = {
      cliente: {
        count: jest.fn().mockResolvedValueOnce(12).mockResolvedValueOnce(3),
        findMany: jest.fn().mockResolvedValue([
          {
            id: 10n,
            nombre: 'Cliente frecuente',
            razonSocial: null,
            numeroDocumento: '12345678',
          },
          {
            id: 11n,
            nombre: 'Cliente ocasional',
            razonSocial: null,
            numeroDocumento: '87654321',
          },
        ]),
      },
      venta: {
        groupBy: groupSalesByClient,
      },
    } as unknown as PrismaService;
    const service = new ReportsService(prisma, passthroughCache);

    const result = await service.findClients(7n, fullScope, {
      dateFilter: '7days',
    });

    expect(result.summary).toEqual({
      activeClients: 12,
      newClientsThisMonth: 3,
      recurrenceRate: 50,
    });
    expect(result.topByPurchases).toHaveLength(2);
    expect(result.topByPurchases[0]).toMatchObject({
      clientId: '10',
      purchases: 2,
      amount: '180.00',
    });
    expect(groupSalesByClient).toHaveBeenCalled();
  });

  it('exports sales and products into two sheets', async () => {
    const prisma = {
      sucursal: { findFirst: jest.fn() },
      venta: {
        findMany: jest.fn().mockResolvedValue([
          {
            codigoInterno: 'V-000001',
            correlativo: 'NV01-000001',
            tipoComprobante: 'boleta',
            serie: 'B001',
            numero: 1,
            createdAt: new Date('2026-01-15T10:30:00.000Z'),
            moneda: 'PEN',
            formaPago: 'CONTADO',
            subtotal: new Prisma.Decimal(100),
            descuentoMonto: new Prisma.Decimal(0),
            igvMonto: new Prisma.Decimal(18),
            total: new Prisma.Decimal(118),
            sunatEstado: 'no_aplica',
            cliente: {
              nombre: 'Ana',
              razonSocial: null,
              tipoDocumento: 'dni',
              numeroDocumento: '12345678',
            },
            sucursal: { nombre: 'Tienda 1' },
            creadoPor: { nombre: 'Luis', apellido: 'Rojas' },
            detalles: [
              {
                descripcion: null,
                cantidad: 2,
                precioUnitario: new Prisma.Decimal(50),
                descuentoMonto: new Prisma.Decimal(0),
                subtotal: new Prisma.Decimal(100),
                total: new Prisma.Decimal(118),
                productoVariante: {
                  sku: 'SKU-1',
                  producto: { nombre: 'Polo' },
                  productoColor: { color: { nombre: 'Negro' } },
                  talla: { nombre: 'M' },
                },
              },
            ],
          },
        ]),
      },
    } as unknown as PrismaService;
    const service = new ReportsService(prisma, passthroughCache);

    const file = await service.exportSalesExcel(1n, fullScope, {
      dateFilter: '7days',
    });

    expect(file.fileName).toMatch(
      /^reporte-ventas-7dias-\d{4}-\d{2}-\d{2}\.xlsx$/,
    );

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.buffer);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'Ventas',
      'Productos vendidos',
    ]);

    const sales = workbook.getWorksheet('Ventas');
    expect(sales?.rowCount).toBe(2);
    expect(sales?.getRow(1).getCell(5).value).toBe('Comprobante');
    expect(sales?.getRow(2).getCell(5).value).toBe('Boleta');
    expect(sales?.getRow(2).getCell(6).value).toBe('Ana');
    expect(sales?.getRow(2).getCell(15).value).toBe(118);

    const products = workbook.getWorksheet('Productos vendidos');
    expect(products?.rowCount).toBe(2);
    expect(products?.getRow(2).getCell(4).value).toBe('Polo');
    expect(products?.getRow(2).getCell(8).value).toBe(2);
  });

  it('exports the top products as CSV', async () => {
    const prisma = {
      sucursal: { findFirst: jest.fn() },
      ventaDetalle: {
        groupBy: jest.fn().mockResolvedValue([
          {
            productoVarianteId: 5n,
            _sum: { cantidad: 3, total: new Prisma.Decimal(150) },
          },
        ]),
      },
      productoVariante: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 5n,
            sku: 'SKU-5',
            codigoBarras: null,
            producto: { nombre: 'Polo', categoria: { nombre: 'Ropa' } },
          },
        ]),
      },
    } as unknown as PrismaService;
    const service = new ReportsService(prisma, passthroughCache);

    const file = await service.exportProductsCsv(1n, fullScope, {
      dateFilter: 'today',
    });
    const csv = file.buffer.toString('utf8');

    expect(file.fileName).toMatch(
      /^reporte-productos-hoy-\d{4}-\d{2}-\d{2}\.csv$/,
    );
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain(
      'Posicion;SKU;Producto;Categoria;Cantidad vendida;Venta total;Precio promedio',
    );
    expect(csv).toContain('1;SKU-5;Polo;Ropa;3;150,00;50,00');
  });

  it('exports the top clients as CSV', async () => {
    const prisma = {
      sucursal: { findFirst: jest.fn() },
      venta: {
        groupBy: jest.fn().mockResolvedValue([
          {
            clienteId: 3n,
            _count: { _all: 4 },
            _sum: { total: new Prisma.Decimal(400) },
          },
        ]),
      },
      cliente: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 3n,
            tipoDocumento: 'ruc',
            numeroDocumento: '20123456789',
            nombre: null,
            razonSocial: 'Comercial Sur SAC',
          },
        ]),
      },
    } as unknown as PrismaService;
    const service = new ReportsService(prisma, passthroughCache);

    const file = await service.exportClientsCsv(1n, fullScope, {
      dateFilter: '14days',
    });
    const csv = file.buffer.toString('utf8');

    expect(file.fileName).toMatch(
      /^reporte-clientes-14dias-\d{4}-\d{2}-\d{2}\.csv$/,
    );
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain(
      'Posicion;Cliente;Documento;Compras;Venta total;Ticket promedio',
    );
    expect(csv).toContain(
      '1;Comercial Sur SAC;RUC 20123456789;4;400,00;100,00',
    );
  });

  it('exports the user ranking as CSV', async () => {
    const prisma = {
      sucursal: { findFirst: jest.fn() },
      empresaUsuario: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 8n,
            usuarioId: 4n,
            usuario: { nombre: 'Luis', apellido: 'Rojas' },
          },
          {
            id: 9n,
            usuarioId: 5n,
            usuario: { nombre: 'Ana', apellido: null },
          },
        ]),
      },
      venta: {
        groupBy: jest
          .fn()
          .mockResolvedValueOnce([
            {
              creadoPorId: 4n,
              _count: { _all: 3 },
              _sum: { total: new Prisma.Decimal(300) },
              _avg: { total: new Prisma.Decimal(100) },
            },
          ])
          .mockResolvedValueOnce([
            {
              creadoPorId: 4n,
              _count: { _all: 1 },
              _sum: { total: new Prisma.Decimal(50) },
            },
          ]),
      },
    } as unknown as PrismaService;
    const service = new ReportsService(prisma, passthroughCache);

    const file = await service.exportUsersCsv(1n, fullScope, {
      dateFilter: '30days',
    });
    const csv = file.buffer.toString('utf8');
    const lines = csv.replace('\uFEFF', '').trim().split('\r\n');

    expect(file.fileName).toMatch(
      /^reporte-usuarios-30dias-\d{4}-\d{2}-\d{2}\.csv$/,
    );
    expect(lines[0]).toBe(
      'Posicion;Usuario;Ventas;Monto vendido;Ticket promedio;Anuladas;Monto anulado',
    );
    expect(lines[1]).toBe('1;Luis Rojas;3;300,00;100,00;1;50,00');
    expect(lines[2]).toBe('2;Ana;0;0,00;0,00;0;0,00');
  });

  it('returns zero product turnover when there are no active variants', async () => {
    const prisma = {
      producto: {
        count: jest.fn().mockResolvedValue(0),
      },
      productoVariante: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      ventaDetalle: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { cantidad: null } }),
        groupBy: jest.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaService;
    const service = new ReportsService(prisma, passthroughCache);

    const result = await service.findProducts(3n, fullScope, {
      dateFilter: '30days',
    });

    expect(result.summary).toEqual({
      activeProducts: 0,
      activeVariants: 0,
      outOfStockVariants: 0,
      averageTurnover: 0,
    });
    expect(result.topByUnits).toEqual([]);
    expect(result.topByAmount).toEqual([]);
  });
});
