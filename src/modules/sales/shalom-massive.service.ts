import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {
  Prisma,
  VentaEnvioAgencia,
  VentaEnvioEstado,
  VentaEstado,
} from '@prisma/client';
import {
  resolveScopedBranchId,
  scopedCreatorId,
  type CommercialScope,
} from '../../common/commercial-access';
import { resolveHistoryDateRange } from '../../common/history-date-range';
import { PrismaService } from '../../prisma/prisma.service';
import {
  shalomAgencias,
  shalomDepartamentos,
  shalomDistritos,
  shalomProvincias,
} from './assets/shalom-masivo-catalogo';
import {
  ExportShalomMassiveDto,
  SHALOM_MAX_EXPORT_SALES,
  SHALOM_MAX_ROWS_PER_FILE,
  SHALOM_MAX_ROWS_PER_RECIPIENT,
} from './dto/export-shalom.dto';

const PACKAGE_TYPES = [
  'SOBRE',
  'PAQUETE XXS',
  'PAQUETE XS',
  'PAQUETE S',
  'PAQUETE M',
  'PAQUETE L',
] as const;

const TEMPLATE_HEADERS = [
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
] as const;

const TEMPLATE_ROWS = 499;
const FIRST_DATA_ROW = 2;
const LAST_DATA_ROW = FIRST_DATA_ROW + TEMPLATE_ROWS - 1;

const agenciaPorCodigo = new Map<string, string>(
  shalomAgencias.map(([codigo, nombre]) => [codigo, nombre]),
);

type SheetWithValidations = ExcelJS.Worksheet & {
  dataValidations: {
    add(address: string, validation: ExcelJS.DataValidation): void;
  };
};

function dimensionFormula(row: number) {
  const ifChain = (values: Record<string, string>) =>
    PACKAGE_TYPES.reduceRight(
      (acc, tipo) => `IF(H${row}="${tipo}",${values[tipo]},${acc})`,
      '""',
    );

  return {
    alto: ifChain({
      SOBRE: '0.1',
      'PAQUETE XXS': '0.15',
      'PAQUETE XS': '0.2',
      'PAQUETE S': '0.3',
      'PAQUETE M': '0.3',
      'PAQUETE L': '0.42',
    }),
    ancho: ifChain({
      SOBRE: '0.1',
      'PAQUETE XXS': '0.1',
      'PAQUETE XS': '0.15',
      'PAQUETE S': '0.3',
      'PAQUETE M': '0.24',
      'PAQUETE L': '0.3',
    }),
    largo: ifChain({
      SOBRE: '0.15',
      'PAQUETE XXS': '0.1',
      'PAQUETE XS': '0.12',
      'PAQUETE S': '0.12',
      'PAQUETE M': '0.2',
      'PAQUETE L': '0.23',
    }),
    peso: ifChain({
      SOBRE: '0',
      'PAQUETE XXS': '0.25',
      'PAQUETE XS': '0.5',
      'PAQUETE S': '2',
      'PAQUETE M': '5',
      'PAQUETE L': '10',
    }),
  };
}

export type ShalomExportRow = {
  salePublicId: string;
  correlativo: string;
  document: string;
  phone: string;
  destino: string;
  agencyCode: string | null;
};

export type ShalomExportFile = {
  buffer: Buffer;
  filename: string;
  contentType: string;
};

@Injectable()
export class ShalomMassiveService {
  constructor(private readonly prisma: PrismaService) {}

  async export(
    empresaId: bigint,
    scope: CommercialScope,
    dto: ExportShalomMassiveDto,
  ): Promise<ShalomExportFile> {
    const rows = await this.rows(empresaId, scope, dto);
    if (rows.length === 0) {
      throw new BadRequestException(
        'No hay envios Shalom pendientes para exportar con los filtros actuales',
      );
    }

    const parts = this.partition(rows);
    const stamp = this.stamp();

    if (parts.length === 1) {
      return {
        buffer: await this.workbook(parts[0]),
        filename: `Formato-Pro-Masivo-${stamp}.xlsx`,
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
    }

    const zip = new JSZip();
    for (let index = 0; index < parts.length; index += 1) {
      zip.file(
        `Formato-Pro-Masivo-parte${index + 1}.xlsx`,
        await this.workbook(parts[index]),
      );
    }
    const buffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    return {
      buffer,
      filename: `Formato-Pro-Masivo-${stamp}.zip`,
      contentType: 'application/zip',
    };
  }

  /**
   * Divide en archivos que respetan los limites de Shalom:
   * 50 filas por archivo y 10 filas por destinatario en el mismo archivo.
   */
  partition(rows: ShalomExportRow[]): ShalomExportRow[][] {
    const parts: ShalomExportRow[][] = [];
    const queue = [...rows];

    while (queue.length > 0) {
      const part: ShalomExportRow[] = [];
      const perRecipient = new Map<string, number>();
      const deferred: ShalomExportRow[] = [];

      while (queue.length > 0 && part.length < SHALOM_MAX_ROWS_PER_FILE) {
        const row = queue.shift()!;
        const key = row.document || `sin-doc:${row.salePublicId}`;
        const count = perRecipient.get(key) ?? 0;
        if (count >= SHALOM_MAX_ROWS_PER_RECIPIENT) {
          deferred.push(row);
          continue;
        }
        part.push(row);
        perRecipient.set(key, count + 1);
      }

      parts.push(part);
      if (deferred.length > 0) queue.unshift(...deferred);
    }

    return parts;
  }

  private async rows(
    empresaId: bigint,
    scope: CommercialScope,
    dto: ExportShalomMassiveDto,
  ): Promise<ShalomExportRow[]> {
    if (dto.mode === 'pickup') {
      throw new BadRequestException(
        'El formato masivo de Shalom solo aplica a envios, no a recojo en tienda',
      );
    }
    if (dto.servicio && dto.servicio !== 'SHALOM') {
      throw new BadRequestException(
        'El formato masivo de Shalom solo incluye envios con agencia Shalom',
      );
    }
    if (dto.publicIds && dto.publicIds.length > SHALOM_MAX_EXPORT_SALES) {
      throw new BadRequestException(
        `Puedes exportar hasta ${SHALOM_MAX_EXPORT_SALES} envios por lote`,
      );
    }

    const search = dto.search?.trim();
    const branchId = resolveScopedBranchId(scope, dto.sucursalId);
    const creatorId = scopedCreatorId(scope);

    const hasDateFilter = Boolean(dto.period || dto.dateFrom || dto.dateTo);
    let fechaEnvioRange: Prisma.DateTimeFilter | undefined;
    if (dto.fechaEnvioDesde || dto.fechaEnvioHasta) {
      const desde = dto.fechaEnvioDesde ?? dto.fechaEnvioHasta!;
      const hasta = dto.fechaEnvioHasta ?? dto.fechaEnvioDesde!;
      if (desde > hasta) {
        throw new BadRequestException(
          'fechaEnvioDesde no puede ser posterior a fechaEnvioHasta',
        );
      }
      const limite = new Date(`${hasta}T00:00:00.000Z`);
      limite.setUTCDate(limite.getUTCDate() + 1);
      fechaEnvioRange = {
        gte: new Date(`${desde}T00:00:00.000Z`),
        lt: limite,
      };
    }

    const where: Prisma.VentaWhereInput = {
      empresaId,
      estado: { not: VentaEstado.anulada },
      envio: {
        is: {
          agencia: VentaEnvioAgencia.SHALOM,
          estado: VentaEnvioEstado.recibido,
          ...(fechaEnvioRange ? { fechaEnvio: fechaEnvioRange } : {}),
        },
      },
      ...(hasDateFilter ? { createdAt: resolveHistoryDateRange(dto) } : {}),
      ...(branchId ? { sucursalId: branchId } : {}),
      ...(creatorId ? { creadoPorId: creatorId } : {}),
      ...(dto.publicIds?.length ? { publicId: { in: dto.publicIds } } : {}),
      ...(search
        ? {
            OR: [
              { codigoInterno: { contains: search, mode: 'insensitive' } },
              { correlativo: { contains: search, mode: 'insensitive' } },
              {
                cliente: {
                  nombre: { contains: search, mode: 'insensitive' },
                },
              },
              {
                cliente: {
                  razonSocial: { contains: search, mode: 'insensitive' },
                },
              },
              { cliente: { numeroDocumento: { contains: search } } },
            ],
          }
        : {}),
    };

    const sales = await this.prisma.venta.findMany({
      where,
      select: {
        publicId: true,
        correlativo: true,
        cliente: {
          select: {
            nombre: true,
            razonSocial: true,
            numeroDocumento: true,
            telefono: true,
          },
        },
        envio: {
          select: {
            dni: true,
            celular: true,
            agenciaExternalId: true,
            agenciaNombre: true,
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: SHALOM_MAX_EXPORT_SALES + 1,
    });

    if (sales.length > SHALOM_MAX_EXPORT_SALES) {
      throw new BadRequestException(
        `La exportacion admite hasta ${SHALOM_MAX_EXPORT_SALES} envios por lote. Ajusta los filtros o selecciona menos envios.`,
      );
    }

    return sales.map((sale) => {
      const code = sale.envio?.agenciaExternalId?.trim() ?? '';
      const document = this.digits(
        sale.envio?.dni || sale.cliente?.numeroDocumento,
      );
      const phone = this.digits(sale.envio?.celular || sale.cliente?.telefono);

      return {
        salePublicId: sale.publicId,
        correlativo: sale.correlativo,
        document,
        phone,
        destino: this.destino(code, sale.envio?.agenciaNombre),
        agencyCode: code || null,
      };
    });
  }

  private destino(code: string, agenciaNombre?: string | null) {
    const fromCatalog = code ? agenciaPorCodigo.get(code) : undefined;
    if (fromCatalog) return fromCatalog;

    return (agenciaNombre ?? '').split(' / ').pop()?.trim() ?? '';
  }

  private digits(value?: string | null) {
    return (value ?? '').replace(/\D/g, '');
  }

  private agencyCode(codigo: string) {
    const numeric = Number(codigo);
    return Number.isFinite(numeric) && String(numeric) === codigo
      ? numeric
      : codigo;
  }

  private stamp() {
    const now = new Date();
    const pad = (value: number) => `${value}`.padStart(2, '0');
    return [
      now.getFullYear(),
      pad(now.getMonth() + 1),
      pad(now.getDate()),
      pad(now.getHours()),
      pad(now.getMinutes()),
    ].join('_');
  }

  private async workbook(rows: ShalomExportRow[]): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Nuvex';
    workbook.created = new Date();

    this.buildHoja1(workbook, rows);
    this.buildHoja2(workbook);
    this.buildMedidas(workbook);

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  private buildHoja1(workbook: ExcelJS.Workbook, rows: ShalomExportRow[]) {
    const sheet = workbook.addWorksheet('Hoja1');

    const header = sheet.addRow([...TEMPLATE_HEADERS]);
    header.font = { bold: true };
    header.alignment = { vertical: 'middle', horizontal: 'center' };

    sheet.columns = [
      { width: 18 },
      { width: 18 },
      { width: 16 },
      { width: 16 },
      { width: 14 },
      { width: 26 },
      { width: 26 },
      { width: 16 },
      { width: 8 },
      { width: 8 },
      { width: 8 },
      { width: 8 },
      { width: 10 },
    ];

    const lastAgenciaRow = shalomAgencias.length;
    const mercaderiaList = `"${PACKAGE_TYPES.join(',')}"`;
    const validations = sheet as SheetWithValidations;

    for (let row = FIRST_DATA_ROW; row <= LAST_DATA_ROW; row += 1) {
      const formulas = dimensionFormula(row);
      sheet.getCell(`I${row}`).value = { formula: formulas.alto };
      sheet.getCell(`J${row}`).value = { formula: formulas.ancho };
      sheet.getCell(`K${row}`).value = { formula: formulas.largo };
      sheet.getCell(`L${row}`).value = { formula: formulas.peso };

      validations.dataValidations.add(`F${row}`, {
        type: 'list',
        allowBlank: false,
        formulae: [`'Hoja2'!B1:B${lastAgenciaRow}`],
        showErrorMessage: false,
      });
      validations.dataValidations.add(`G${row}`, {
        type: 'list',
        allowBlank: false,
        formulae: [`'Hoja2'!C2:C${lastAgenciaRow + 1}`],
        showErrorMessage: false,
      });
      validations.dataValidations.add(`H${row}`, {
        type: 'list',
        allowBlank: false,
        formulae: [mercaderiaList],
        showErrorMessage: false,
      });
    }

    rows.forEach((row, index) => {
      const target = sheet.getRow(FIRST_DATA_ROW + index);
      target.getCell(1).value = row.document;
      target.getCell(2).value = row.phone;
      target.getCell(7).value = row.destino;
      target.getCell(13).value = 1;
    });
  }

  private buildHoja2(workbook: ExcelJS.Workbook) {
    const sheet = workbook.addWorksheet('Hoja2');

    shalomAgencias.forEach(([codigo, nombre], index) => {
      const row = index + 1;
      sheet.getCell(`A${row}`).value = this.agencyCode(codigo);
      sheet.getCell(`B${row}`).value = nombre;
      sheet.getCell(`C${row + 1}`).value = nombre;
    });

    shalomDepartamentos.forEach((value, index) => {
      sheet.getCell(`E${index + 2}`).value = value;
    });
    shalomProvincias.forEach((value, index) => {
      sheet.getCell(`F${index + 2}`).value = value;
    });
    shalomDistritos.forEach((value, index) => {
      sheet.getCell(`G${index + 2}`).value = value;
    });

    sheet.columns = [
      { width: 10 },
      { width: 42 },
      { width: 42 },
      { width: 4 },
      { width: 18 },
      { width: 24 },
      { width: 30 },
    ];
  }

  private buildMedidas(workbook: ExcelJS.Workbook) {
    const sheet = workbook.addWorksheet('Medidas');

    sheet.getCell('C1').value = 'ANCHO';
    sheet.getCell('D1').value = 'LARGO';
    sheet.getCell('E1').value = 'PESO';

    shalomAgencias.forEach(([codigo, nombre], index) => {
      const row = index + 1;
      sheet.getCell(`A${row}`).value = this.agencyCode(codigo);
      sheet.getCell(`B${row}`).value = nombre;
      sheet.getCell(`C${row + 1}`).value = nombre;
    });

    [0.1, 0.12, 0.15, 0.2, 0.23, 0.42].forEach((value, index) => {
      sheet.getCell(`D${index + 2}`).value = value;
    });

    shalomDepartamentos.forEach((value, index) => {
      sheet.getCell(`E${index + 2}`).value = value;
    });
    shalomProvincias.forEach((value, index) => {
      sheet.getCell(`F${index + 2}`).value = value;
    });
    shalomDistritos.forEach((value, index) => {
      sheet.getCell(`G${index + 2}`).value = value;
    });

    sheet.columns = [
      { width: 10 },
      { width: 42 },
      { width: 42 },
      { width: 10 },
      { width: 18 },
      { width: 24 },
      { width: 30 },
    ];
  }
}
