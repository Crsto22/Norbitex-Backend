import { ProductoTipo } from '@prisma/client';
import { ProductsService } from './products.service';

describe('ProductsService normal products', () => {
  it('creates one hidden technical presentation without commercial variants', async () => {
    const tx = {
      color: { upsert: jest.fn().mockResolvedValue({ id: 11n }) },
      talla: { upsert: jest.fn().mockResolvedValue({ id: 22n }) },
    };
    const prisma = {
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        Promise.resolve(callback(tx)),
      ),
    };
    const service = new ProductsService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const result = await (
      service as unknown as {
        resolveProductInputs: (
          empresaId: bigint,
          tipo: ProductoTipo,
          dto: Record<string, string>,
        ) => Promise<{
          colores: Array<{ colorId: string }>;
          variantes: Array<{ colorId: string; tallaId: string }>;
          imagenes: Array<{ colorId: string }>;
        }>;
      }
    ).resolveProductInputs(1n, ProductoTipo.normal, {
      simple: JSON.stringify({ precioVenta: '25.00', stocks: [] }),
      imagenes: JSON.stringify([{ orden: 0, esPrincipal: true }]),
    });

    expect(result.colores).toEqual([{ colorId: '11', activo: true }]);
    expect(result.variantes[0]).toMatchObject({
      colorId: '11',
      tallaId: '22',
      precioVenta: '25.00',
    });
    expect(result.imagenes[0].colorId).toBe('11');
  });
});
