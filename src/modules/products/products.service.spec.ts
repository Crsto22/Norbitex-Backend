import { ProductoTipo } from '@prisma/client';
import ExcelJS from 'exceljs';
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

const exportProduct = {
  id: 7n,
  publicId: 'prod-public-7',
  empresaId: 1n,
  nombre: 'Polo export',
  tipo: 'variantes',
  descripcion: 'Polo de prueba',
  controlaStock: true,
  activo: true,
  marca: { nombre: 'Marca X' },
  categoria: { nombre: 'Polos' },
  unidadMedida: { codigo: 'NIU', descripcion: 'Unidad' },
  tipoAfectacionIgv: { codigo: '10', descripcion: 'Gravado' },
  variantes: [
    {
      sku: 'SKU-1',
      codigoBarras: '7750000001',
      precioCompra: { toString: () => '10.00' },
      precioVenta: { toString: () => '25.00' },
      precioMayorista: null,
      activo: true,
      talla: { nombre: 'M' },
      productoColor: { activo: true, color: { nombre: 'Negro' } },
      inventarios: [{ sucursalId: 2n, stockActual: 0, stockMinimo: 1 }],
    },
    {
      sku: 'SKU-2',
      codigoBarras: null,
      precioCompra: null,
      precioVenta: { toString: () => '30.00' },
      precioMayorista: { toString: () => '28.00' },
      activo: false,
      talla: { nombre: 'L' },
      productoColor: { activo: true, color: { nombre: 'Azul' } },
      inventarios: [{ sucursalId: 2n, stockActual: 5, stockMinimo: 2 }],
    },
  ],
};

describe('ProductsService export', () => {
  const createService = () =>
    new ProductsService(
      {
        producto: {
          findMany: jest.fn().mockResolvedValue([exportProduct]),
        },
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

  it('exports one row per variant including zero stock in the branch', async () => {
    const service = createService();

    const file = await service.exportProducts(
      1n,
      {
        userId: 1n,
        branchId: null,
        visibility: 'todas',
        isOwner: true,
      } as never,
      { sucursalId: '2', format: 'csv' },
    );
    const csv = file.buffer.toString('utf8');
    const lines = csv.replace('\uFEFF', '').trim().split('\r\n');

    expect(file.fileName).toMatch(
      /^catalogo-productos-sucursal-2-\d{4}-\d{2}-\d{2}\.csv$/,
    );
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('Nombre;SKU;Código de barras;Categoría');
    expect(lines[0]).toContain('Precio oferta;Stock;Stock mínimo');
    expect(lines[0]).toContain('Cod. producto SUNAT');
    expect(lines[0]).not.toContain('Tipo de producto');
    expect(lines[0]).not.toContain('ID público');
    // Primera variante con stock 0 en la sucursal 2 igual aparece
    expect(lines[1]).toContain(
      'Polo export;SKU-1;7750000001;Polos;Marca X;M;Negro;Polo de prueba;10,00;25,00;;',
    );
    expect(lines[2]).toContain('SKU-2');
    expect(lines[2]).toContain('No'); // variante inactiva
  });

  it('exports an Excel book with the products sheet', async () => {
    const service = createService();

    const file = await service.exportProducts(
      1n,
      {
        userId: 1n,
        branchId: null,
        visibility: 'todas',
        isOwner: true,
      } as never,
      { format: 'xlsx' },
    );

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.buffer);
    const sheet = workbook.getWorksheet('Productos');

    expect(file.fileName).toMatch(
      /^catalogo-productos-todas-\d{4}-\d{2}-\d{2}\.xlsx$/,
    );
    expect(sheet?.rowCount).toBe(3);
    expect(sheet?.getRow(1).getCell(1).value).toBe('Nombre');
    expect(sheet?.getRow(2).getCell(2).value).toBe('SKU-1');
    expect(sheet?.getRow(2).getCell(13).value).toBe(0);
    expect(sheet?.getRow(3).getCell(13).value).toBe(5);
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
