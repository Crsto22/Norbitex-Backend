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
import {
  SHALOM_EXPORT_MODES,
  SHALOM_PACKAGE_TYPES,
  type ShalomExportMode,
  type ShalomPackageType,
  type UpdateShalomExportSettingsDto,
} from './dto/shalom-export-settings.dto';

const PACKAGE_TYPES = SHALOM_PACKAGE_TYPES;

type PackageDimensions = {
  alto: number;
  ancho: number;
  largo: number;
  peso: number;
};

const PACKAGE_DIMENSIONS: Record<ShalomPackageType, PackageDimensions> = {
  SOBRE: { alto: 0.1, ancho: 0.1, largo: 0.15, peso: 0 },
  'PAQUETE XXS': { alto: 0.15, ancho: 0.1, largo: 0.1, peso: 0.25 },
  'PAQUETE XS': { alto: 0.2, ancho: 0.15, largo: 0.12, peso: 0.5 },
  'PAQUETE S': { alto: 0.3, ancho: 0.3, largo: 0.12, peso: 2 },
  'PAQUETE M': { alto: 0.3, ancho: 0.24, largo: 0.2, peso: 5 },
  'PAQUETE L': { alto: 0.42, ancho: 0.3, largo: 0.23, peso: 10 },
};

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
const agenciaNombres = new Set(shalomAgencias.map(([, nombre]) => nombre));

export type ShalomExportSettings = {
  origen: string | null;
  modo: ShalomExportMode;
  mercaderia: ShalomPackageType | null;
  alto: number | null;
  ancho: number | null;
  largo: number | null;
  peso: number | null;
};

const DEFAULT_SETTINGS: ShalomExportSettings = {
  origen: null,
  modo: 'ninguno',
  mercaderia: null,
  alto: null,
  ancho: null,
  largo: null,
  peso: null,
};

type SheetWithValidations = ExcelJS.Worksheet & {
  dataValidations: {
    add(address: string, validation: ExcelJS.DataValidation): void;
  };
};

function dimensionFormula(row: number) {
  const ifChain = (key: keyof PackageDimensions) =>
    PACKAGE_TYPES.reduceRight(
      (acc, tipo) =>
        `IF(H${row}="${tipo}",${PACKAGE_DIMENSIONS[tipo][key]},${acc})`,
      '""',
    );

  return {
    alto: ifChain('alto'),
    ancho: ifChain('ancho'),
    largo: ifChain('largo'),
    peso: ifChain('peso'),
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
    const [rows, settings] = await Promise.all([
      this.rows(empresaId, scope, dto),
      this.settings(empresaId),
    ]);
    if (rows.length === 0) {
      throw new BadRequestException(
        'No hay envios Shalom pendientes para exportar con los filtros actuales',
      );
    }

    const parts = this.partition(rows);
    const stamp = this.stamp();

    if (parts.length === 1) {
      return {
        buffer: await this.workbook(parts[0], settings),
        filename: `Formato-Pro-Masivo-${stamp}.xlsx`,
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
    }

    const zip = new JSZip();
    for (let index = 0; index < parts.length; index += 1) {
      zip.file(
        `Formato-Pro-Masivo-parte${index + 1}.xlsx`,
        await this.workbook(parts[index], settings),
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

  async getSettings(empresaId: bigint): Promise<ShalomExportSettings> {
    return this.settings(empresaId);
  }

  origins(): string[] {
    return [...agenciaNombres].sort((a, b) => a.localeCompare(b, 'es'));
  }

  async updateSettings(
    empresaId: bigint,
    dto: UpdateShalomExportSettingsDto,
  ): Promise<ShalomExportSettings> {
    const modo: ShalomExportMode = SHALOM_EXPORT_MODES.includes(dto.modo)
      ? dto.modo
      : 'ninguno';
    const origen = dto.origen?.trim() || null;

    if (origen && !agenciaNombres.has(origen)) {
      throw new BadRequestException(
        'El origen seleccionado no existe en el catalogo de agencias de Shalom',
      );
    }

    let mercaderia: ShalomPackageType | null = null;
    let alto: number | null = null;
    let ancho: number | null = null;
    let largo: number | null = null;
    let peso: number | null = null;

    if (modo === 'mercaderia') {
      if (!dto.mercaderia || !PACKAGE_TYPES.includes(dto.mercaderia)) {
        throw new BadRequestException(
          'Selecciona un tipo de mercaderia valido para este modo',
        );
      }
      mercaderia = dto.mercaderia;
      // Shalom calcula alto, ancho, largo y peso segun la mercaderia:
      // solo se envia el nombre del paquete en la columna MERCADERIA.
    }

    if (modo === 'medidas') {
      const values = [dto.alto, dto.ancho, dto.largo, dto.peso];
      if (values.some((value) => value === null || value === undefined)) {
        throw new BadRequestException(
          'Completa alto, ancho, largo y peso para el modo medidas',
        );
      }
      alto = this.decimal(dto.alto);
      ancho = this.decimal(dto.ancho);
      largo = this.decimal(dto.largo);
      peso = this.decimal(dto.peso);
      if ([alto, ancho, largo].some((value) => !value || value <= 0)) {
        throw new BadRequestException(
          'Alto, ancho y largo deben ser mayores a cero',
        );
      }
      if (peso === null || peso < 0) {
        throw new BadRequestException('El peso no puede ser negativo');
      }
    }

    const record = await this.prisma.empresaShalomExportConfig.upsert({
      where: { empresaId },
      create: {
        empresaId,
        origen,
        modo,
        mercaderia,
        alto,
        ancho,
        largo,
        peso,
      },
      update: {
        origen,
        modo,
        mercaderia,
        alto,
        ancho,
        largo,
        peso,
      },
    });

    return this.toSettings(record);
  }

  private async settings(empresaId: bigint): Promise<ShalomExportSettings> {
    const record = await this.prisma.empresaShalomExportConfig.findUnique({
      where: { empresaId },
    });
    return record ? this.toSettings(record) : { ...DEFAULT_SETTINGS };
  }

  private toSettings(record: {
    origen: string | null;
    modo: string;
    mercaderia: string | null;
    alto: unknown;
    ancho: unknown;
    largo: unknown;
    peso: unknown;
  }): ShalomExportSettings {
    const modo = SHALOM_EXPORT_MODES.includes(record.modo as ShalomExportMode)
      ? (record.modo as ShalomExportMode)
      : 'ninguno';

    return {
      origen: record.origen?.trim() || null,
      modo,
      mercaderia: record.mercaderia
        ? (record.mercaderia as ShalomPackageType)
        : null,
      alto: this.number(record.alto),
      ancho: this.number(record.ancho),
      largo: this.number(record.largo),
      peso: this.number(record.peso),
    };
  }

  private number(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private decimal(value?: number | null): number | null {
    const parsed = this.number(value);
    return parsed === null ? null : Math.round(parsed * 1000) / 1000;
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

  private async workbook(
    rows: ShalomExportRow[],
    settings: ShalomExportSettings,
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Nuvex';
    workbook.created = new Date();

    this.buildHoja1(workbook, rows, settings);
    this.buildHoja2(workbook);
    this.buildMedidas(workbook);

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  private buildHoja1(
    workbook: ExcelJS.Workbook,
    rows: ShalomExportRow[],
    settings: ShalomExportSettings,
  ) {
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
      const targetRow = FIRST_DATA_ROW + index;
      const target = sheet.getRow(targetRow);
      target.getCell(1).value = row.document;
      target.getCell(2).value = row.phone;
      if (settings.origen) target.getCell(6).value = settings.origen;
      target.getCell(7).value = row.destino;
      target.getCell(13).value = 1;

      if (settings.modo === 'mercaderia' && settings.mercaderia) {
        // Shalom calcula alto, ancho, largo y peso de cada mercaderia:
        // solo se escribe el nombre y se conservan las formulas del formato.
        target.getCell(8).value = settings.mercaderia;
      } else if (settings.modo === 'medidas') {
        target.getCell(9).value = settings.alto;
        target.getCell(10).value = settings.ancho;
        target.getCell(11).value = settings.largo;
        target.getCell(12).value = settings.peso;
      }
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
