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

function serviceWith(rows: ReturnType<typeof sale>[]) {
  const prisma = { venta: { findMany: jest.fn().mockResolvedValue(rows) } };
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
  });
});
