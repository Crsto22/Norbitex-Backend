import { ProductoTipo } from '@prisma/client';
import { ProductsService } from './products.service';
import { resolveSunatUnitCode } from './sunat-unit-codes';

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

describe('product branch filter', () => {
  it('only matches variants with stock in the requested branch', () => {
    const service = new ProductsService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const where = (
      service as unknown as {
        buildProductVariantWhere: (params: {
          empresaId: bigint;
          colorId: bigint | null;
          tallaId: bigint | null;
          sucursalId: bigint | null;
        }) => unknown;
      }
    ).buildProductVariantWhere({
      empresaId: 1n,
      colorId: null,
      tallaId: null,
      sucursalId: 2n,
    });

    expect(where).toMatchObject({
      inventarios: {
        some: {
          empresaId: 1n,
          sucursalId: 2n,
          stockActual: { gt: 0 },
        },
      },
    });
  });
});

describe('SUNAT unit codes', () => {
  it('defaults to NIU when the product has no unit code', () => {
    expect(resolveSunatUnitCode(undefined)).toEqual({
      code: 'NIU',
      description: 'Unidad',
    });
  });

  it('accepts allowed SUNAT unit codes case-insensitively', () => {
    expect(resolveSunatUnitCode('kgm')).toEqual({
      code: 'KGM',
      description: 'Kilogramo',
    });
  });

  it('rejects unit codes outside the curated SUNAT catalog', () => {
    expect(() => resolveSunatUnitCode('ABC')).toThrow(
      'Unidad SUNAT no permitida: ABC',
    );
  });
});
