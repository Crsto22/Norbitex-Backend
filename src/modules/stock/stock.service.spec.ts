/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { StockMovimientoTipo } from '@prisma/client';
import { StockService } from './stock.service';

describe('StockService', () => {
  const service = new StockService({} as never);

  it('actualiza el saldo y registra el movimiento en la misma transaccion', async () => {
    const createdMovement = { id: 1n, stockAnterior: 5, stockPosterior: 8 };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1n }]),
      inventarioSucursal: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ stockActual: 5, stockMinimo: 1 }),
        upsert: jest.fn().mockResolvedValue({ stockActual: 8 }),
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
        }),
      }),
    );
  });

  it('rechaza una salida que dejaria el stock negativo', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 1n }]),
      inventarioSucursal: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ stockActual: 2, stockMinimo: 0 }),
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
});
