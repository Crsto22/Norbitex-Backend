/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Prisma,
  StockMovimientoDireccion,
  StockMovimientoTipo,
} from '@prisma/client';
import { StockService } from './stock.service';

describe('StockService', () => {
  const service = new StockService({} as never);

  it('actualiza el saldo y registra el movimiento en la misma transaccion', async () => {
    const createdMovement = { id: 1n, stockAnterior: 5, stockPosterior: 8 };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1n }]),
      inventarioSucursal: {
        findUnique: jest.fn().mockResolvedValue({
          stockActual: 5,
          stockMinimo: 1,
          costoPromedio: new Prisma.Decimal(10),
          valorStock: new Prisma.Decimal(50),
        }),
        upsert: jest.fn().mockResolvedValue({ stockActual: 8 }),
      },
      productoVariante: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ precioCompra: new Prisma.Decimal(12) }),
      },
      stockMovimiento: {
        create: jest.fn().mockResolvedValue(createdMovement),
      },
    };

    await expect(
      service.changeStock(tx as never, {
        empresaId: 1n,
        sucursalId: 2n,
        productoVarianteId: 3n,
        delta: 3,
        tipo: StockMovimientoTipo.entrada_manual,
      }),
    ).resolves.toBe(createdMovement);
    expect(tx.inventarioSucursal.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ stockActual: 8 }),
      }),
    );
    expect(tx.stockMovimiento.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          cantidad: 3,
          stockAnterior: 5,
          stockPosterior: 8,
          costoUnitario: new Prisma.Decimal(12),
          costoPromedioAnterior: new Prisma.Decimal(10),
          costoPromedioPosterior: new Prisma.Decimal('10.75'),
          valorMovimiento: new Prisma.Decimal(36),
          valorStockAnterior: new Prisma.Decimal(50),
          valorStockPosterior: new Prisma.Decimal(86),
        }),
      }),
    );
  });

  it('recalcula el costo promedio ponderado en entradas', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1n }]),
      inventarioSucursal: {
        findUnique: jest.fn().mockResolvedValue({
          stockActual: 10,
          stockMinimo: 0,
          costoPromedio: new Prisma.Decimal(5),
          valorStock: new Prisma.Decimal(50),
        }),
        upsert: jest.fn(),
      },
      stockMovimiento: {
        create: jest.fn().mockResolvedValue({ id: 1n }),
      },
    };

    await service.changeStock(tx as never, {
      empresaId: 1n,
      sucursalId: 2n,
      productoVarianteId: 3n,
      delta: 10,
      tipo: StockMovimientoTipo.entrada_manual,
      costoUnitario: 7,
    });

    expect(tx.inventarioSucursal.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          stockActual: 20,
          costoPromedio: new Prisma.Decimal(6),
          valorStock: new Prisma.Decimal(120),
        }),
      }),
    );
  });

  it('usa el costo promedio vigente en salidas', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1n }]),
      inventarioSucursal: {
        findUnique: jest.fn().mockResolvedValue({
          stockActual: 10,
          stockMinimo: 0,
          costoPromedio: new Prisma.Decimal(5),
          valorStock: new Prisma.Decimal(50),
        }),
        upsert: jest.fn(),
      },
      stockMovimiento: {
        create: jest.fn().mockResolvedValue({ id: 1n }),
      },
    };

    await service.changeStock(tx as never, {
      empresaId: 1n,
      sucursalId: 2n,
      productoVarianteId: 3n,
      delta: -4,
      tipo: StockMovimientoTipo.salida_manual,
    });

    expect(tx.stockMovimiento.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          costoUnitario: new Prisma.Decimal(5),
          valorMovimiento: new Prisma.Decimal(20),
          valorStockPosterior: new Prisma.Decimal(30),
        }),
      }),
    );
  });

  it('rechaza una salida que dejaria el stock negativo', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1n }]),
      inventarioSucursal: {
        findUnique: jest.fn().mockResolvedValue({
          stockActual: 2,
          stockMinimo: 0,
          costoPromedio: new Prisma.Decimal(0),
          valorStock: new Prisma.Decimal(0),
        }),
      },
    };

    await expect(
      service.changeStock(tx as never, {
        empresaId: 1n,
        sucursalId: 2n,
        productoVarianteId: 3n,
        delta: -3,
        tipo: StockMovimientoTipo.salida_manual,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'INSUFFICIENT_STOCK' }),
    });
  });

  it('calcula el resumen de kardex por variante y sucursal', async () => {
    const variant = {
      id: 3n,
      publicId: 'variant-uuid-1',
      sku: 'SKU-1',
      codigoBarras: null,
      producto: {
        id: 9n,
        publicId: 'prod_1',
        nombre: 'Polo',
        tipo: 'normal',
      },
      productoColor: { color: { nombre: 'Unico', hex: '#000000' } },
      talla: { nombre: 'U' },
    };
    const row = {
      id: 10n,
      direccion: StockMovimientoDireccion.entrada,
      tipo: StockMovimientoTipo.entrada_manual,
      cantidad: 4,
      stockAnterior: 6,
      stockPosterior: 10,
      costoUnitario: new Prisma.Decimal(8),
      costoPromedioAnterior: new Prisma.Decimal(5),
      costoPromedioPosterior: new Prisma.Decimal('6.2'),
      valorMovimiento: new Prisma.Decimal(32),
      valorStockAnterior: new Prisma.Decimal(30),
      valorStockPosterior: new Prisma.Decimal(62),
      motivo: 'Compra',
      referenciaTipo: null,
      referenciaId: null,
      createdAt: new Date('2026-08-17T10:00:00Z'),
      sucursal: { id: 2n, nombre: 'Tienda', tipo: 'tienda' },
      productoVariante: variant,
      creadoPor: null,
      traspaso: null,
    };
    const prisma = {
      productoVariante: { findFirst: jest.fn().mockResolvedValue(variant) },
      $transaction: jest.fn().mockResolvedValue([
        [row],
        1,
        [
          {
            direccion: StockMovimientoDireccion.entrada,
            cantidad: 4,
            valorMovimiento: new Prisma.Decimal(32),
          },
          {
            direccion: StockMovimientoDireccion.salida,
            cantidad: 1,
            valorMovimiento: new Prisma.Decimal(6),
          },
        ],
      ]),
      stockMovimiento: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([
          {
            stockPosterior: 6,
            valorStockPosterior: new Prisma.Decimal(30),
          },
        ]),
      },
    };
    const scoped = {
      userId: 1n,
      branchId: null,
      visibility: 'todas',
      isOwner: true,
    };

    const result = await new StockService(prisma as never).findKardex(
      1n,
      scoped as never,
      {
        productoVarianteId: '3',
        sucursalId: '2',
        from: '2026-08-17',
        page: 1,
        limit: 25,
      },
    );

    expect(result.resumen).toEqual({
      saldoInicial: 6,
      entradas: 4,
      salidas: 1,
      saldoFinal: 9,
      valorInicial: '30',
      valorEntradas: '32',
      valorSalidas: '6',
      valorFinal: '56',
    });
    expect(result.data[0]).toEqual(
      expect.objectContaining({
        cantidad: 4,
        valorMovimiento: '32',
      }),
    );
  });

  it('lista variantes para seleccionar Kardex con filtros y paginacion', async () => {
    const variant = {
      id: 3n,
      publicId: 'variant-uuid-1',
      sku: 'SKU-1',
      codigoBarras: null,
      activo: true,
      precioCompra: new Prisma.Decimal(5),
      precioVenta: new Prisma.Decimal(10),
      producto: {
        id: 9n,
        publicId: 'prod_1',
        nombre: 'Polo',
        tipo: 'variantes',
        marca: { id: 1n, nombre: 'Marca' },
        categoria: { id: 2n, nombre: 'Categoria' },
      },
      productoColor: {
        color: { id: 4n, nombre: 'Rojo', hex: '#ff0000' },
        imagenes: [
          {
            urlThumbnail: 'thumb.webp',
            urlWebp: 'image.webp',
            urlOriginal: 'image.png',
          },
        ],
      },
      talla: { id: 5n, nombre: 'M' },
      inventarios: [
        {
          sucursalId: 7n,
          stockActual: 12,
          sucursal: { id: 7n, nombre: 'Tienda', tipo: 'tienda' },
        },
      ],
    };
    const prisma = {
      $transaction: jest.fn().mockResolvedValue([[variant], 1]),
      productoVariante: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };
    const scoped = {
      userId: 1n,
      branchId: null,
      visibility: 'todas',
      isOwner: true,
    };

    const result = await new StockService(prisma as never).findKardexVariants(
      1n,
      scoped as never,
      {
        search: 'polo',
        colorId: '4',
        tallaId: '5',
        sucursalId: '7',
        page: 1,
        limit: 12,
      },
    );

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(result.meta).toEqual({
      page: 1,
      limit: 12,
      total: 1,
      totalPages: 1,
    });
    expect(result.data[0]).toEqual(
      expect.objectContaining({
        variantPublicId: 'variant-uuid-1',
        nombre: 'Polo',
        color: expect.objectContaining({ nombre: 'Rojo' }),
        talla: expect.objectContaining({ nombre: 'M' }),
        stockTotal: 12,
        stockSucursal: 12,
        imageUrl: 'thumb.webp',
      }),
    );
  });
});
