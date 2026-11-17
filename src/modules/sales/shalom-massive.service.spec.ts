import ExcelJS from 'exceljs';
import { BadRequestException } from '@nestjs/common';
import type { CommercialScope } from '../../common/commercial-access';
import {
  ShalomMassiveService,
  type ShalomExportRow,
} from './shalom-massive.service';

const scope: CommercialScope = {
  userId: 1n,
  branchId: null,
  visibility: 'todas',
  isOwner: true,
};

function row(index: number, document: string): ShalomExportRow {
  return {
    salePublicId: `sale-${index}`,
    correlativo: `NV01-000${index}`,
    document,
    phone: '999888777',
    destino: 'BAGUA CAPITAL',
    agencyCode: '622',
  };
}

function sale(document: string, index: number) {
  return {
    publicId: `sale-${index}`,
    correlativo: `NV01-000${index}`,
    cliente: {
      nombre: 'Juan Perez',
      razonSocial: null,
      numeroDocumento: document,
      telefono: '988777666',
    },
    envio: {
      dni: document,
      celular: '999888777',
      agenciaExternalId: '622',
      agenciaNombre: 'AMAZONAS / BAGUA / BAGUA / BAGUA CAPITAL',
    },
  };
}

function serviceWith(
  rows: ReturnType<typeof sale>[],
  config: Record<string, unknown> | null = null,
) {
  const prisma = {
    venta: { findMany: jest.fn().mockResolvedValue(rows) },
    agenciaCourier: { findMany: jest.fn().mockResolvedValue([]) },
    empresaShalomExportConfig: {
      findUnique: jest.fn().mockResolvedValue(config),
      upsert: jest
        .fn()
        .mockImplementation(({ create }: { create: unknown }) =>
          Promise.resolve(create),
        ),
    },
  };
  return { service: new ShalomMassiveService(prisma as never), prisma };
}

describe('ShalomMassiveService', () => {
  describe('partition', () => {
    it('respeta 50 filas por archivo', () => {
      const { service } = serviceWith([]);
      const rows = Array.from({ length: 120 }, (_, index) =>
        row(index, `2${index.toString().padStart(7, '0')}`),
      );

      const parts = service.partition(rows);

      expect(parts.map((part) => part.length)).toEqual([50, 50, 20]);
    });

    it('respeta 10 filas por destinatario en un mismo archivo', () => {
      const { service } = serviceWith([]);
      const rows = [
        ...Array.from({ length: 12 }, (_, index) => row(index, '11111111')),
        ...Array.from({ length: 45 }, (_, index) =>
          row(100 + index, `2000000${index}`),
        ),
      ];

      const parts = service.partition(rows);

      expect(parts.map((part) => part.length)).toEqual([50, 7]);
      expect(
        parts.map(
          (part) => part.filter((item) => item.document === '11111111').length,
        ),
      ).toEqual([10, 2]);
    });
  });

  describe('export', () => {
    it('genera un xlsx con las hojas y columnas del formato', async () => {
      const { service } = serviceWith([
        sale('70503353', 1),
        sale('12345678', 2),
      ]);

      const file = await service.export(1n, scope, {});

      expect(file.filename).toMatch(/^Formato-Pro-Masivo-.*\.xlsx$/);
      expect(file.contentType).toContain('spreadsheetml');

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(file.buffer as unknown as ArrayBuffer);

      expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
        'Hoja1',
        'Hoja2',
        'Medidas',
      ]);

      const hoja1 = workbook.getWorksheet('Hoja1')!;
      expect(hoja1.getRow(1).values).toEqual([
        undefined,
        'DESTINATARIO (DOC)',
        'TELF. DESTINATARIO',
        'CONTACTO (DOC)',
        'TELF. CONTACTO',
        'NRO GRR',
        'ORIGEN',
        'DESTINO',
        'MERCADERIA',
        'ALTO',
        'ANCHO',
        'LARGO',
        'PESO',
        'CANTIDAD',
      ]);

      // Datos precargados: documento, telefono, destino y cantidad.
      expect(hoja1.getCell('A2').value).toBe('70503353');
      expect(hoja1.getCell('B2').value).toBe('999888777');
      expect(hoja1.getCell('G2').value).toBe('BAGUA CAPITAL');
      expect(hoja1.getCell('M2').value).toBe(1);

      // Lo que el usuario completa en Excel queda vacio.
      expect(hoja1.getCell('F2').value).toBeNull();
      expect(hoja1.getCell('H2').value).toBeNull();
      expect(hoja1.getCell('C3').value).toBeNull();

      // Formulas de medidas y filas libres del formato.
      expect(String(hoja1.getCell('I2').value?.formula)).toContain('PAQUETE L');
      expect(hoja1.rowCount).toBe(500);
      expect(hoja1.getCell('M500').value).toBeNull();
    });

    it('rechaza recojo en tienda', async () => {
      const { service } = serviceWith([]);

      await expect(
        service.export(1n, scope, {
          mode: 'pickup',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza servicios distintos a Shalom', async () => {
      const { service } = serviceWith([]);

      await expect(
        service.export(1n, scope, {
          servicio: 'OLVA',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('devuelve zip cuando la seleccion supera 50 envios', async () => {
      const rows = Array.from({ length: 60 }, (_, index) =>
        sale(`2${index.toString().padStart(7, '0')}`, index),
      );
      const { service } = serviceWith(rows);

      const file = await service.export(1n, scope, {});

      expect(file.filename).toMatch(/^Formato-Pro-Masivo-.*\.zip$/);
      expect(file.contentType).toBe('application/zip');
    });

    it('aplica origen y mercaderia sin escribir las medidas', async () => {
      const { service } = serviceWith([sale('70503353', 1)], {
        origen: 'BAGUA CAPITAL',
        modo: 'mercaderia',
        mercaderia: 'PAQUETE L',
        alto: null,
        ancho: null,
        largo: null,
        peso: null,
      });

      const file = await service.export(1n, scope, {});
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(file.buffer as unknown as ArrayBuffer);
      const hoja1 = workbook.getWorksheet('Hoja1')!;

      expect(hoja1.getCell('F2').value).toBe('BAGUA CAPITAL');
      expect(hoja1.getCell('H2').value).toBe('PAQUETE L');
      // Shalom calcula las medidas: se mantienen las formulas del formato.
      expect(String(hoja1.getCell('I2').value?.formula)).toContain('PAQUETE L');
      expect(hoja1.getCell('J2').value?.formula).toBeDefined();
      expect(hoja1.getCell('K2').value?.formula).toBeDefined();
      expect(hoja1.getCell('L2').value?.formula).toBeDefined();
    });

    it('aplica medidas personalizadas y deja mercaderia vacia', async () => {
      const { service } = serviceWith([sale('70503353', 1)], {
        origen: 'AV TACNA',
        modo: 'medidas',
        mercaderia: null,
        alto: 0.5,
        ancho: 0.4,
        largo: 0.3,
        peso: 3,
      });

      const file = await service.export(1n, scope, {});
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(file.buffer as unknown as ArrayBuffer);
      const hoja1 = workbook.getWorksheet('Hoja1')!;

      expect(hoja1.getCell('F2').value).toBe('AV TACNA');
      expect(hoja1.getCell('H2').value).toBeNull();
      expect(hoja1.getCell('I2').value).toBe(0.5);
      expect(hoja1.getCell('J2').value).toBe(0.4);
      expect(hoja1.getCell('K2').value).toBe(0.3);
      expect(hoja1.getCell('L2').value).toBe(3);
    });
  });

  describe('settings', () => {
    it('devuelve las agencias de Shalom con su ubicacion', async () => {
      const { service, prisma } = serviceWith([]);
      prisma.agenciaCourier.findMany.mockResolvedValue([
        {
          externalId: '622',
          nombre: 'AMAZONAS / BAGUA / BAGUA / BAGUA CAPITAL',
          direccion: 'Av. Amazonas 123',
          departamento: null,
          provincia: null,
          distrito: null,
        },
      ]);

      const origins = await service.origins();

      expect(origins.length).toBe(514);
      expect(origins.find((item) => item.externalId === '622')).toEqual({
        externalId: '622',
        nombre: 'BAGUA CAPITAL',
        departamento: 'AMAZONAS',
        provincia: 'BAGUA',
        distrito: 'BAGUA',
        direccion: 'Av. Amazonas 123',
      });
      expect(origins.map((item) => item.nombre)).toEqual(
        [...origins.map((item) => item.nombre)].sort((a, b) =>
          a.localeCompare(b, 'es'),
        ),
      );
    });

    it('devuelve valores por defecto cuando no hay configuracion', async () => {
      const { service } = serviceWith([]);

      await expect(service.getSettings(1n)).resolves.toEqual({
        origen: null,
        modo: 'ninguno',
        mercaderia: null,
        alto: null,
        ancho: null,
        largo: null,
        peso: null,
      });
    });

    it('guarda modo mercaderia sin medidas propias', async () => {
      const { service, prisma } = serviceWith([]);

      const settings = await service.updateSettings(1n, {
        modo: 'mercaderia',
        mercaderia: 'PAQUETE M',
        origen: 'AV TACNA',
      });

      expect(prisma.empresaShalomExportConfig.upsert).toHaveBeenCalled();
      expect(settings).toMatchObject({
        origen: 'AV TACNA',
        modo: 'mercaderia',
        mercaderia: 'PAQUETE M',
        alto: null,
        ancho: null,
        largo: null,
        peso: null,
      });
    });

    it('exige las 4 medidas en modo medidas', async () => {
      const { service } = serviceWith([]);

      await expect(
        service.updateSettings(1n, { modo: 'medidas', alto: 0.5 }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rechaza un origen que no esta en el catalogo', async () => {
      const { service } = serviceWith([]);

      await expect(
        service.updateSettings(1n, {
          modo: 'ninguno',
          origen: 'AGENCIA INVENTADA',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('exige mercaderia valida en modo mercaderia', async () => {
      const { service } = serviceWith([]);

      await expect(
        service.updateSettings(1n, { modo: 'mercaderia' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
