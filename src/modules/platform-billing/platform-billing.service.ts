import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CobroAdicionalEstado,
  ClienteTipoDocumento,
  ComisionAfiliadoEstado,
  ComisionAfiliadoTipo,
  LiquidacionExcedenteEstado,
  LiquidacionAfiliadoEstado,
  PagoSuscripcionEstado,
  PlataformaComprobanteEstado,
  PlataformaComprobanteTipo,
  Prisma,
  SunatBajaEstado,
  SunatBajaTipo,
  SunatEstado,
  VentaTipoComprobante,
} from '@prisma/client';
import { SecretsCryptoService } from '../../common/crypto/secrets-crypto.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { R2StorageService } from '../storage/r2-storage.service';
import { SalesPdfService } from '../sales/sales-pdf.service';
import {
  CreateExtraChargeDto,
  FindPlatformReceiptsDto,
  FindPlatformSeriesDto,
  IssueHistoricalReceiptDto,
  RequestPlatformCancellationDto,
  UpdatePlatformIssuerDto,
  UploadPlatformCertificateDto,
  UpsertPlatformSeriesDto,
} from './platform-billing.dto';

const receiptInclude = {
  empresa: { select: { id: true, nombreComercial: true, email: true } },
  creadoPor: {
    select: { id: true, nombre: true, apellido: true, email: true },
  },
  detalles: true,
  pagoSuscripcion: {
    select: {
      id: true,
      estado: true,
      metodoPago: true,
      metodoPagoOtro: true,
    },
  },
  suscripcionAsistencia: {
    select: {
      id: true,
      estado: true,
      metodoPago: true,
      metodoPagoOtro: true,
    },
  },
  liquidacionExcedente: {
    select: {
      id: true,
      estado: true,
      periodo: true,
      metodoPago: true,
      metodoPagoOtro: true,
    },
  },
  cobroAdicional: {
    select: {
      id: true,
      estado: true,
      metodoPago: true,
      metodoPagoOtro: true,
    },
  },
  comprobanteOrigen: { select: { id: true, serie: true, numero: true } },
} satisfies Prisma.ComprobantePlataformaInclude;

type Receipt = Prisma.ComprobantePlataformaGetPayload<{
  include: typeof receiptInclude;
}>;
type Tx = Prisma.TransactionClient;
type ReceiptItem = {
  description: string;
  quantity: Prisma.Decimal;
  total: Prisma.Decimal;
  listTotal?: Prisma.Decimal;
};

@Injectable()
export class PlatformBillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsCryptoService,
    private readonly storage: R2StorageService,
    private readonly salesPdf: SalesPdfService,
  ) {}

  async getIssuerConfig() {
    const config =
      await this.prisma.configuracionFacturacionPlataforma.findUnique({
        where: { id: 1 },
      });
    return this.mapConfig(config);
  }

  async updateIssuerConfig(actor: JwtPayload, dto: UpdatePlatformIssuerDto) {
    const actorId = this.id(actor.sub, 'administrador');
    const data: Prisma.ConfiguracionFacturacionPlataformaUncheckedUpdateInput =
      {
        ...(dto.ruc !== undefined ? { ruc: dto.ruc || null } : {}),
        ...(dto.businessName !== undefined
          ? { razonSocial: dto.businessName || null }
          : {}),
        ...(dto.tradeName !== undefined
          ? { nombreComercial: dto.tradeName || null }
          : {}),
        ...(dto.address !== undefined
          ? { direccion: dto.address || null }
          : {}),
        ...(dto.ubigeo !== undefined ? { ubigeo: dto.ubigeo || null } : {}),
        ...(dto.environment !== undefined ? { ambiente: dto.environment } : {}),
        ...(dto.solUser !== undefined
          ? { usuarioSolEncrypted: this.encrypt(dto.solUser) }
          : {}),
        ...(dto.solPassword !== undefined
          ? { claveSolEncrypted: this.encrypt(dto.solPassword) }
          : {}),
        ...(dto.igvPercent !== undefined
          ? { igvPorcentaje: new Prisma.Decimal(dto.igvPercent) }
          : {}),
        ...(dto.active !== undefined ? { activo: dto.active } : {}),
        actualizadoPorId: actorId,
      };
    const before =
      await this.prisma.configuracionFacturacionPlataforma.findUnique({
        where: { id: 1 },
      });
    const updated = await this.prisma.configuracionFacturacionPlataforma.update(
      {
        where: { id: 1 },
        data,
      },
    );
    await this.audit(
      actorId,
      null,
      'platform_billing_config_updated',
      'Configuracion fiscal de Nuvex actualizada',
      {
        previousActive: before?.activo ?? false,
        currentActive: updated.activo,
        environment: updated.ambiente,
      },
    );
    return this.mapConfig(updated);
  }

  async uploadCertificate(
    actor: JwtPayload,
    dto: UploadPlatformCertificateDto,
    file: Express.Multer.File,
  ) {
    if (
      file.size > 2 * 1024 * 1024 ||
      !/\.(pfx|p12)$/i.test(file.originalname)
    ) {
      throw new BadRequestException(
        'El certificado debe ser .pfx o .p12 y no superar 2MB',
      );
    }
    const current =
      await this.prisma.configuracionFacturacionPlataforma.findUnique({
        where: { id: 1 },
      });
    const uploaded = await this.storage.uploadPlatformSunatCertificate(file);
    try {
      const updated =
        await this.prisma.configuracionFacturacionPlataforma.upsert({
          where: { id: 1 },
          create: {
            id: 1,
            certificadoPasswordEncrypted: this.secrets.encrypt(
              dto.certificatePassword,
            ),
            certificadoR2Key: uploaded.r2Key,
            certificadoNombre: uploaded.nombre,
            certificadoMimeType: uploaded.mimeType,
            certificadoSizeBytes: uploaded.sizeBytes,
            certificadoUploadedAt: new Date(),
            actualizadoPorId: this.id(actor.sub, 'administrador'),
          },
          update: {
            certificadoPasswordEncrypted: this.secrets.encrypt(
              dto.certificatePassword,
            ),
            certificadoR2Key: uploaded.r2Key,
            certificadoNombre: uploaded.nombre,
            certificadoMimeType: uploaded.mimeType,
            certificadoSizeBytes: uploaded.sizeBytes,
            certificadoUploadedAt: new Date(),
            actualizadoPorId: this.id(actor.sub, 'administrador'),
          },
        });
      await this.storage.deleteSunatCertificate(current?.certificadoR2Key);
      return this.mapConfig(updated);
    } catch (error) {
      await this.storage.deleteSunatCertificate(uploaded.r2Key);
      throw error;
    }
  }

  async listSeries(query: FindPlatformSeriesDto) {
    const where: Prisma.SerieComprobantePlataformaWhereInput = {
      ...(query.type ? { tipo: query.type } : {}),
      ...(query.status ? { activo: query.status === 'activo' } : {}),
      ...(query.search
        ? { serie: { contains: query.search, mode: 'insensitive' } }
        : {}),
    };
    const [rows, total, active, inactive, issued] =
      await this.prisma.$transaction([
        this.prisma.serieComprobantePlataforma.findMany({
          where,
          orderBy: [{ tipo: 'asc' }, { serie: 'asc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.limit,
          take: query.limit,
        }),
        this.prisma.serieComprobantePlataforma.count({ where }),
        this.prisma.serieComprobantePlataforma.count({
          where: { activo: true },
        }),
        this.prisma.serieComprobantePlataforma.count({
          where: { activo: false },
        }),
        this.prisma.serieComprobantePlataforma.aggregate({
          _sum: { correlativo: true },
        }),
      ]);
    return {
      data: rows.map((row) => ({
        id: row.id.toString(),
        type: row.tipo,
        series: row.serie,
        currentNumber: row.correlativo,
        active: row.activo,
      })),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
      summary: {
        active,
        inactive,
        issued: issued._sum.correlativo ?? 0,
      },
    };
  }

  async createSeries(dto: UpsertPlatformSeriesDto) {
    const row = await this.prisma.serieComprobantePlataforma.create({
      data: { tipo: dto.type, serie: dto.series, activo: dto.active ?? true },
    });
    return {
      id: row.id.toString(),
      type: row.tipo,
      series: row.serie,
      currentNumber: row.correlativo,
      active: row.activo,
    };
  }

  async updateSeries(id: string, dto: UpsertPlatformSeriesDto) {
    const row = await this.prisma.serieComprobantePlataforma.update({
      where: { id: this.id(id, 'serie') },
      data: { tipo: dto.type, serie: dto.series, activo: dto.active },
    });
    return {
      id: row.id.toString(),
      type: row.tipo,
      series: row.serie,
      currentNumber: row.correlativo,
      active: row.activo,
    };
  }

  async findReceipts(query: FindPlatformReceiptsDto, empresaId?: bigint) {
    const where: Prisma.ComprobantePlataformaWhereInput = {
      ...(empresaId ? { empresaId } : {}),
      ...(query.type ? { tipo: query.type } : {}),
      ...(query.status ? { estado: query.status } : {}),
      ...(query.search
        ? {
            OR: [
              {
                receptorNombre: { contains: query.search, mode: 'insensitive' },
              },
              { receptorDocumento: { contains: query.search } },
              { serie: { contains: query.search, mode: 'insensitive' } },
              {
                empresa: {
                  nombreComercial: {
                    contains: query.search,
                    mode: 'insensitive',
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.comprobantePlataforma.findMany({
        where,
        include: receiptInclude,
        orderBy: [{ fechaEmision: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.comprobantePlataforma.count({ where }),
    ]);
    return {
      data: rows.map((row) => this.mapReceipt(row)),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  async getReceipt(id: string, empresaId?: bigint) {
    const row = await this.prisma.comprobantePlataforma.findFirst({
      where: {
        id: this.id(id, 'comprobante'),
        ...(empresaId ? { empresaId } : {}),
      },
      include: receiptInclude,
    });
    if (!row) throw new NotFoundException('Comprobante no encontrado');
    return row;
  }

  async issueHistorical(actor: JwtPayload, dto: IssueHistoricalReceiptDto) {
    const actorId = this.id(actor.sub, 'administrador');
    const sourceId = this.id(dto.sourceId, 'origen');
    const result = await this.serializable(async (tx) => {
      if (dto.sourceType === 'subscription') {
        const source = await tx.pagoSuscripcion.findUnique({
          where: { id: sourceId },
        });
        if (!source || source.estado !== PagoSuscripcionEstado.pagado)
          throw new NotFoundException(
            'Pago de suscripcion vigente no encontrado',
          );
        return this.createReceipt(tx, {
          requestId: dto.requestId,
          actorId,
          empresaId: source.empresaId,
          type: dto.receiptType,
          total: source.montoTotal,
          items: [
            {
              description: `Plan ${source.planCodigo} por ${source.meses} mes(es)`,
              quantity: new Prisma.Decimal(1),
              total: source.montoTotal,
            },
          ],
          pagoSuscripcionId: source.id,
        });
      }
      const source = await tx.liquidacionExcedente.findUnique({
        where: { id: sourceId },
      });
      if (!source || source.estado !== LiquidacionExcedenteEstado.pagado)
        throw new NotFoundException('Liquidacion pagada no encontrada');
      return this.createReceipt(tx, {
        requestId: dto.requestId,
        actorId,
        empresaId: source.empresaId,
        type: dto.receiptType,
        total: source.montoTotal,
        items: [
          {
            description: `Comprobantes excedentes ${source.periodo}`,
            quantity: new Prisma.Decimal(source.cantidad),
            total: source.montoTotal,
          },
        ],
        liquidacionExcedenteId: source.id,
      });
    });
    return this.mapReceipt(result);
  }

  async createExtraCharge(actor: JwtPayload, dto: CreateExtraChargeDto) {
    const actorId = this.id(actor.sub, 'administrador');
    const empresaId = this.id(dto.companyId, 'empresa');
    const result = await this.serializable(async (tx) => {
      const duplicate = await tx.cobroAdicionalPlataforma.findUnique({
        where: { requestId: dto.requestId },
        include: { comprobante: { include: receiptInclude } },
      });
      if (duplicate?.comprobante) return duplicate.comprobante;
      const total = new Prisma.Decimal(dto.quantity)
        .mul(dto.unitPrice)
        .toDecimalPlaces(2);
      const charge = await tx.cobroAdicionalPlataforma.create({
        data: {
          requestId: dto.requestId,
          empresaId,
          registradoPorId: actorId,
          descripcion: dto.description,
          cantidad: new Prisma.Decimal(dto.quantity),
          precioUnitario: new Prisma.Decimal(dto.unitPrice),
          montoTotal: total,
          metodoPago: dto.paymentMethod,
          metodoPagoOtro: dto.paymentMethodOther,
        },
      });
      await tx.platformAuditLog.create({
        data: {
          empresaId,
          usuarioId: actorId,
          category: 'billing',
          action: 'platform_extra_charge_created',
          source: 'admin',
          description: `Cobro adicional registrado: ${dto.description}`,
          metadata: {
            chargeId: charge.id.toString(),
            total: total.toFixed(2),
            paymentMethod: dto.paymentMethod,
          },
        },
      });
      return this.createReceipt(tx, {
        requestId: dto.requestId,
        actorId,
        empresaId,
        type: dto.receiptType,
        total,
        items: [
          {
            description: dto.description,
            quantity: new Prisma.Decimal(dto.quantity),
            total,
          },
        ],
        cobroAdicionalId: charge.id,
      });
    });
    return this.mapReceipt(result);
  }

  async retry(actor: JwtPayload, id: string) {
    const receipt = await this.getReceipt(id);
    if (receipt.tipo === PlataformaComprobanteTipo.nota_venta)
      throw new BadRequestException('La nota de venta no se envia a SUNAT');
    const retryingCancellation = Boolean(receipt.sunatBajaEstado);
    await this.prisma.comprobantePlataforma.update({
      where: { id: receipt.id },
      data: {
        estado: retryingCancellation
          ? PlataformaComprobanteEstado.anulacion_pendiente
          : PlataformaComprobanteEstado.pendiente,
        ...(retryingCancellation
          ? {
              sunatBajaEstado: SunatBajaEstado.pendiente_envio,
              sunatBajaMensaje: null,
            }
          : { sunatMensaje: null }),
        sunatJob: {
          upsert: {
            create: {
              estado: 'pendiente',
              operacion: retryingCancellation ? 'baja' : 'emision',
            },
            update: {
              estado: 'pendiente',
              operacion: retryingCancellation ? 'baja' : 'emision',
              siguienteIntentoAt: new Date(),
              ultimoError: null,
              intentos: 0,
            },
          },
        },
      },
    });
    await this.audit(
      this.id(actor.sub, 'administrador'),
      receipt.empresaId,
      'platform_receipt_retried',
      `Reintento solicitado para ${receipt.serie}-${receipt.numero}`,
      { receiptId: receipt.id.toString() },
    );
    return { queued: true };
  }

  async finalizeAcceptedCreditNote(id: bigint) {
    await this.serializable(async (tx) => {
      const credit = await tx.comprobantePlataforma.findUnique({
        where: { id },
        include: { comprobanteOrigen: { include: receiptInclude } },
      });
      if (
        !credit?.comprobanteOrigen ||
        credit.tipo !== PlataformaComprobanteTipo.nota_credito
      ) {
        throw new ConflictException(
          'La nota de credito no tiene comprobante de origen',
        );
      }
      if (
        credit.comprobanteOrigen.estado !== PlataformaComprobanteEstado.anulado
      ) {
        await this.reverseSource(
          tx,
          credit.comprobanteOrigen,
          credit.creadoPorId,
          credit.motivoNotaCredito ?? 'Anulacion total',
        );
        await tx.comprobantePlataforma.update({
          where: { id: credit.comprobanteOrigen.id },
          data: { estado: PlataformaComprobanteEstado.anulado },
        });
      }
    });
  }

  async requestCancellation(
    actor: JwtPayload,
    id: string,
    dto: RequestPlatformCancellationDto,
  ) {
    const actorId = this.id(actor.sub, 'administrador');
    const receiptId = this.id(id, 'comprobante');
    const result = await this.serializable(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "comprobante_plataforma" WHERE "id" = ${receiptId} FOR UPDATE`;
      const source = await tx.comprobantePlataforma.findUnique({
        where: { id: receiptId },
        include: receiptInclude,
      });
      if (!source) throw new NotFoundException('Comprobante no encontrado');
      if (source.sunatBajaRequestId === dto.requestId) return source;
      if (
        source.estado === PlataformaComprobanteEstado.anulado ||
        source.estado === PlataformaComprobanteEstado.anulacion_pendiente
      )
        throw new ConflictException('El comprobante ya tiene una anulacion');
      if (source.tipo === PlataformaComprobanteTipo.nota_credito)
        throw new BadRequestException('No se puede anular una nota de credito');
      if (source.tipo === PlataformaComprobanteTipo.nota_venta) {
        await this.reverseSource(tx, source, actorId, dto.reason);
        const now = new Date();
        return tx.comprobantePlataforma.update({
          where: { id: source.id },
          data: {
            estado: PlataformaComprobanteEstado.anulado,
            sunatMensaje: dto.reason,
            sunatBajaRequestId: dto.requestId,
            sunatBajaEstado: SunatBajaEstado.no_aplica,
            sunatBajaMotivo: dto.reason,
            sunatBajaMensaje: 'Nota de venta anulada internamente.',
            sunatBajaSolicitadaAt: now,
            sunatBajaRespondidaAt: now,
          },
          include: receiptInclude,
        });
      }
      if (
        source.tipo !== PlataformaComprobanteTipo.boleta &&
        source.tipo !== PlataformaComprobanteTipo.factura
      ) {
        throw new BadRequestException('El comprobante no soporta baja SUNAT');
      }
      if (source.estado !== PlataformaComprobanteEstado.aceptado)
        throw new ConflictException(
          'SUNAT debe aceptar el comprobante antes de solicitar la baja',
        );
      if (!source.xmlR2Key || !source.cdrR2Key)
        throw new ConflictException(
          'El comprobante no tiene XML y CDR de emision disponibles',
        );
      await this.requireElectronicConfig(tx);
      const tipo = platformCancellationType(source.tipo)!;
      const fechaGeneracion = this.limaDate(new Date());
      const sequence = await tx.secuenciaBajaPlataforma.upsert({
        where: { tipo_fechaGeneracion: { tipo, fechaGeneracion } },
        create: { tipo, fechaGeneracion },
        update: { correlativo: { increment: 1 } },
      });
      return tx.comprobantePlataforma.update({
        where: { id: source.id },
        data: {
          estado: PlataformaComprobanteEstado.anulacion_pendiente,
          sunatBajaRequestId: dto.requestId,
          sunatBajaEstado: SunatBajaEstado.pendiente_envio,
          sunatBajaTipo: tipo,
          sunatBajaCorrelativo: sequence.correlativo,
          sunatBajaMotivo: dto.reason,
          sunatBajaCodigo: null,
          sunatBajaMensaje:
            'Solicitud de baja registrada. Pendiente de envio a SUNAT.',
          sunatBajaTicket: null,
          sunatBajaXmlR2Key: null,
          sunatBajaCdrR2Key: null,
          sunatBajaSolicitadaAt: new Date(),
          sunatBajaRespondidaAt: null,
          sunatJob: {
            upsert: {
              create: { operacion: 'baja', estado: 'pendiente' },
              update: {
                operacion: 'baja',
                estado: 'pendiente',
                intentos: 0,
                siguienteIntentoAt: new Date(),
                ultimoError: null,
              },
            },
          },
        },
        include: receiptInclude,
      });
    });
    await this.audit(
      actorId,
      result.empresaId,
      result.tipo === PlataformaComprobanteTipo.nota_venta
        ? 'platform_receipt_cancelled'
        : 'platform_sunat_cancellation_requested',
      result.tipo === PlataformaComprobanteTipo.nota_venta
        ? `Nota de venta anulada: ${result.serie}-${result.numero}`
        : `Baja SUNAT solicitada: ${result.serie}-${result.numero}`,
      { receiptId: result.id.toString(), reason: dto.reason },
    );
    return this.mapReceipt(result);
  }

  async finalizeAcceptedCancellation(id: bigint) {
    await this.serializable(async (tx) => {
      const receipt = await tx.comprobantePlataforma.findUnique({
        where: { id },
        include: receiptInclude,
      });
      if (!receipt) throw new NotFoundException('Comprobante no encontrado');
      if (receipt.estado === PlataformaComprobanteEstado.anulado) return;
      await this.reverseSource(
        tx,
        receipt,
        receipt.creadoPorId,
        receipt.sunatBajaMotivo ?? 'Baja SUNAT aceptada',
      );
      await tx.comprobantePlataforma.update({
        where: { id },
        data: { estado: PlataformaComprobanteEstado.anulado },
      });
    });
  }

  async downloadCancellation(id: string, kind: 'xml' | 'cdr') {
    const receipt = await this.getReceipt(id);
    const key =
      kind === 'xml' ? receipt.sunatBajaXmlR2Key : receipt.sunatBajaCdrR2Key;
    if (!key)
      throw new NotFoundException(
        `El ${kind.toUpperCase()} de baja aun no esta disponible`,
      );
    return {
      fileName: `baja-${receipt.serie}-${String(receipt.numero).padStart(8, '0')}.${kind === 'xml' ? 'xml' : 'zip'}`,
      url: await this.storage.getSignedSunatDocumentUrl(
        key,
        `baja-${receipt.serie}-${String(receipt.numero).padStart(8, '0')}.${kind === 'xml' ? 'xml' : 'zip'}`,
      ),
    };
  }

  async download(id: string, kind: 'pdf' | 'xml' | 'cdr', empresaId?: bigint) {
    const receipt = await this.getReceipt(id, empresaId);
    if (kind === 'pdf')
      return {
        buffer: await this.buildPdf(receipt),
        contentType: 'application/pdf',
        fileName: `${receipt.serie}-${String(receipt.numero).padStart(8, '0')}.pdf`,
      };
    const key = kind === 'xml' ? receipt.xmlR2Key : receipt.cdrR2Key;
    if (!key)
      throw new NotFoundException(
        `El ${kind.toUpperCase()} aun no esta disponible`,
      );
    return {
      fileName: `${receipt.serie}-${String(receipt.numero).padStart(8, '0')}.${kind === 'xml' ? 'xml' : 'zip'}`,
      url: await this.storage.getSignedSunatDocumentUrl(
        key,
        `${receipt.serie}-${String(receipt.numero).padStart(8, '0')}.${kind === 'xml' ? 'xml' : 'zip'}`,
      ),
    };
  }

  createReceiptForSubscription(
    tx: Tx,
    params: {
      requestId: string;
      actorId: bigint;
      paymentId: bigint;
      empresaId: bigint;
      type: PlataformaComprobanteTipo;
      description: string;
      total: Prisma.Decimal;
      listTotal?: Prisma.Decimal;
    },
  ) {
    return this.createReceipt(tx, {
      ...params,
      items: [
        {
          description: params.description,
          quantity: new Prisma.Decimal(1),
          listTotal: params.listTotal,
          total: params.total,
        },
      ],
      pagoSuscripcionId: params.paymentId,
    });
  }

  createReceiptForCheckout(
    tx: Tx,
    params: {
      requestId: string;
      actorId: bigint;
      empresaId: bigint;
      type: PlataformaComprobanteTipo;
      total: Prisma.Decimal;
      pagoSuscripcionId?: bigint;
      suscripcionAsistenciaId?: bigint;
      items: ReceiptItem[];
    },
  ) {
    return this.createReceipt(tx, params);
  }

  createReceiptForOverage(
    tx: Tx,
    params: {
      requestId: string;
      actorId: bigint;
      liquidationId: bigint;
      empresaId: bigint;
      type: PlataformaComprobanteTipo;
      description: string;
      quantity: number;
      total: Prisma.Decimal;
    },
  ) {
    return this.createReceipt(tx, {
      ...params,
      items: [
        {
          description: params.description,
          quantity: new Prisma.Decimal(params.quantity),
          total: params.total,
        },
      ],
      liquidacionExcedenteId: params.liquidationId,
    });
  }

  private async createReceipt(
    tx: Tx,
    params: {
      requestId: string;
      actorId: bigint;
      empresaId: bigint;
      type: PlataformaComprobanteTipo;
      total: Prisma.Decimal;
      items: ReceiptItem[];
      pagoSuscripcionId?: bigint;
      suscripcionAsistenciaId?: bigint;
      liquidacionExcedenteId?: bigint;
      cobroAdicionalId?: bigint;
    },
  ) {
    const duplicate = await tx.comprobantePlataforma.findUnique({
      where: { requestId: params.requestId },
      include: receiptInclude,
    });
    if (duplicate) return duplicate;
    const company = await tx.empresa.findUnique({
      where: { id: params.empresaId },
      select: {
        id: true,
        nombreComercial: true,
        razonSocial: true,
        ruc: true,
        dni: true,
        direccion: true,
      },
    });
    if (!company) throw new NotFoundException('Empresa no encontrada');
    const receiver = this.receiver(company, params.type);
    const config =
      params.type === PlataformaComprobanteTipo.nota_venta
        ? null
        : await this.requireElectronicConfig(tx);
    const igvPercent = config?.igvPorcentaje ?? new Prisma.Decimal(18);
    const { base, igv } = calculateIncludedTax(params.total, igvPercent);
    const details = params.items.map((item) => {
      const taxes = calculateIncludedTax(item.total, igvPercent);
      const listTotal = item.listTotal ?? item.total;
      return {
        descripcion: item.description,
        cantidad: item.quantity,
        precioUnitario: listTotal.div(item.quantity).toDecimalPlaces(2),
        baseImponible: taxes.base,
        igv: taxes.igv,
        total: item.total,
      };
    });
    const sequence = await this.nextNumber(tx, params.type);
    const receipt = await tx.comprobantePlataforma.create({
      data: {
        requestId: params.requestId,
        empresaId: params.empresaId,
        creadoPorId: params.actorId,
        serieId: sequence.id,
        tipo: params.type,
        serie: sequence.serie,
        numero: sequence.numero,
        pagoSuscripcionId: params.pagoSuscripcionId,
        suscripcionAsistenciaId: params.suscripcionAsistenciaId,
        liquidacionExcedenteId: params.liquidacionExcedenteId,
        cobroAdicionalId: params.cobroAdicionalId,
        receptorTipoDocumento: receiver.type,
        receptorDocumento: receiver.document,
        receptorNombre: receiver.name,
        receptorDireccion: company.direccion,
        baseImponible: base,
        igv,
        total: params.total,
        estado:
          params.type === PlataformaComprobanteTipo.nota_venta
            ? PlataformaComprobanteEstado.aceptado
            : PlataformaComprobanteEstado.pendiente,
        detalles: {
          create: details,
        },
        ...(params.type === PlataformaComprobanteTipo.nota_venta
          ? {}
          : { sunatJob: { create: {} } }),
      },
      include: receiptInclude,
    });
    await tx.platformAuditLog.create({
      data: {
        empresaId: params.empresaId,
        usuarioId: params.actorId,
        category: 'billing',
        action: 'platform_receipt_issued',
        source: 'admin',
        description: `${this.typeLabel(params.type)} ${sequence.serie}-${sequence.numero} emitida`,
        metadata: {
          receiptId: receipt.id.toString(),
          total: params.total.toFixed(2),
        },
      },
    });
    return receipt;
  }

  private async requireElectronicConfig(tx: Tx) {
    const config = await tx.configuracionFacturacionPlataforma.findUnique({
      where: { id: 1 },
    });
    if (
      !config?.activo ||
      !config.ruc ||
      !config.razonSocial ||
      !config.usuarioSolEncrypted ||
      !config.claveSolEncrypted ||
      !config.certificadoR2Key ||
      !config.certificadoPasswordEncrypted
    ) {
      throw new ConflictException({
        code: 'PLATFORM_ISSUER_NOT_CONFIGURED',
        message: 'Completa y activa la configuracion fiscal de Nuvex',
      });
    }
    return config;
  }

  private receiver(
    company: {
      nombreComercial: string;
      razonSocial: string | null;
      ruc: string | null;
      dni: string | null;
    },
    type: PlataformaComprobanteTipo,
  ) {
    if (type === PlataformaComprobanteTipo.factura) {
      if (!company.ruc || !/^\d{11}$/.test(company.ruc) || !company.razonSocial)
        throw new BadRequestException(
          'La factura requiere RUC de 11 digitos y razon social',
        );
      return { type: '6', document: company.ruc, name: company.razonSocial };
    }
    if (type === PlataformaComprobanteTipo.boleta) {
      const document = company.dni ?? company.ruc;
      if (!document || !/^(\d{8}|\d{11})$/.test(document))
        throw new BadRequestException('La boleta requiere DNI o RUC valido');
      return {
        type: document.length === 11 ? '6' : '1',
        document,
        name: company.razonSocial ?? company.nombreComercial,
      };
    }
    return {
      type: company.ruc ? '6' : company.dni ? '1' : '0',
      document: company.ruc ?? company.dni,
      name: company.razonSocial ?? company.nombreComercial,
    };
  }

  private async nextNumber(tx: Tx, type: PlataformaComprobanteTipo) {
    const rows = await tx.$queryRaw<
      Array<{ id: bigint; serie: string; correlativo: number }>
    >`SELECT "id", "serie", "correlativo" FROM "serie_comprobante_plataforma" WHERE "tipo" = CAST(${type} AS "PlataformaComprobanteTipo") AND "activo" = true ORDER BY "id" LIMIT 1 FOR UPDATE`;
    const current = rows[0];
    if (!current)
      throw new ConflictException(
        `No existe una serie activa para ${this.typeLabel(type)}`,
      );
    const numero = current.correlativo + 1;
    await tx.serieComprobantePlataforma.update({
      where: { id: current.id },
      data: { correlativo: numero },
    });
    return { id: current.id, serie: current.serie, numero };
  }

  private async reverseSource(
    tx: Tx,
    receipt: Receipt,
    actorId: bigint,
    reason: string,
  ) {
    if (receipt.pagoSuscripcionId) {
      const sale = await tx.pagoSuscripcion.findUnique({
        where: { id: receipt.pagoSuscripcionId },
      });
      if (!sale || sale.estado !== PagoSuscripcionEstado.pagado)
        throw new ConflictException('El pago ya no puede revertirse');
      const latest = await tx.pagoSuscripcion.findFirst({
        where: {
          empresaId: receipt.empresaId,
          estado: PagoSuscripcionEstado.pagado,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      if (latest?.id !== sale.id)
        throw new ConflictException('Existe una operacion de plan posterior');
      await tx.empresa.update({
        where: { id: receipt.empresaId },
        data: {
          planCodigo: sale.planAnteriorCodigo,
          planInicioAt: sale.planAnteriorInicioAt,
          planFinAt: sale.planAnteriorFinAt,
        },
      });
      await tx.pagoSuscripcion.update({
        where: { id: sale.id },
        data: {
          estado: PagoSuscripcionEstado.anulado,
          anuladoPorId: actorId,
          anuladoAt: new Date(),
          motivoAnulacion: reason,
        },
      });
      await this.reverseAffiliateCommission(tx, receipt, new Date());
    }
    if (receipt.suscripcionAsistenciaId) {
      const subscription = await tx.suscripcionAsistencia.findUnique({
        where: { id: receipt.suscripcionAsistenciaId },
      });
      if (!subscription || subscription.estado !== 'activa')
        throw new ConflictException('La suscripcion ya no puede revertirse');
      const latest = await tx.suscripcionAsistencia.findFirst({
        where: {
          empresaId: receipt.empresaId,
          estado: 'activa',
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      if (latest?.id !== subscription.id)
        throw new ConflictException(
          'Existe una operacion de Asistencias posterior',
        );
      await tx.empresa.update({
        where: { id: receipt.empresaId },
        data: {
          asistenciasActiva: subscription.asistenciaAnteriorActiva,
          asistenciasTrabajadoresLimite:
            subscription.limiteAnteriorTrabajadores,
          asistenciasPuntosQrLimite: subscription.limiteAnteriorPuntosQr,
          asistenciasInicioAt: subscription.asistenciaAnteriorInicioAt,
          asistenciasFinAt: subscription.asistenciaAnteriorFinAt,
        },
      });
      await tx.suscripcionAsistencia.update({
        where: { id: subscription.id },
        data: {
          estado: 'cancelada',
          anuladoPorId: actorId,
          anuladoAt: new Date(),
          motivoAnulacion: reason,
        },
      });
      await this.reverseAffiliateCommission(tx, receipt, new Date());
    } else if (receipt.liquidacionExcedenteId) {
      await tx.liquidacionExcedente.update({
        where: { id: receipt.liquidacionExcedenteId },
        data: { estado: LiquidacionExcedenteEstado.anulado },
      });
    } else if (receipt.cobroAdicionalId) {
      await tx.cobroAdicionalPlataforma.update({
        where: { id: receipt.cobroAdicionalId },
        data: {
          estado: CobroAdicionalEstado.anulado,
          anuladoAt: new Date(),
          motivoAnulacion: reason,
        },
      });
    }
  }

  private async reverseAffiliateCommission(
    tx: Tx,
    receipt: Pick<
      Receipt,
      'pagoSuscripcionId' | 'suscripcionAsistenciaId' | 'empresaId'
    >,
    now: Date,
  ) {
    const commission = await tx.comisionAfiliado.findFirst({
      where: {
        tipo: ComisionAfiliadoTipo.venta,
        OR: [
          ...(receipt.pagoSuscripcionId
            ? [{ pagoSuscripcionId: receipt.pagoSuscripcionId }]
            : []),
          ...(receipt.suscripcionAsistenciaId
            ? [{ suscripcionAsistenciaId: receipt.suscripcionAsistenciaId }]
            : []),
        ],
      },
      include: { liquidacion: true },
    });
    if (!commission) return;

    if (commission.estado === ComisionAfiliadoEstado.pendiente) {
      await tx.comisionAfiliado.update({
        where: { id: commission.id },
        data: { estado: ComisionAfiliadoEstado.anulada },
      });
      return;
    }

    if (
      commission.liquidacion?.estado === LiquidacionAfiliadoEstado.pendiente
    ) {
      await tx.comisionAfiliado.update({
        where: { id: commission.id },
        data: { estado: ComisionAfiliadoEstado.anulada },
      });
      await tx.liquidacionAfiliado.update({
        where: { id: commission.liquidacion.id },
        data: {
          cantidad: { decrement: 1 },
          montoTotal: { decrement: commission.monto },
        },
      });
      return;
    }

    if (commission.liquidacion?.estado === LiquidacionAfiliadoEstado.pagada) {
      await tx.comisionAfiliado.create({
        data: {
          afiliadoId: commission.afiliadoId,
          empresaId: receipt.empresaId,
          pagoSuscripcionId: commission.pagoSuscripcionId,
          suscripcionAsistenciaId: commission.suscripcionAsistenciaId,
          tipo: ComisionAfiliadoTipo.ajuste_anulacion,
          periodo: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
          baseCalculo: commission.baseCalculo,
          porcentaje: commission.porcentaje,
          monto: commission.monto.negated(),
        },
      });
    }
  }

  private async buildPdf(receipt: Receipt) {
    const issuer =
      await this.prisma.configuracionFacturacionPlataforma.findUnique({
        where: { id: 1 },
      });
    const type =
      receipt.tipo === PlataformaComprobanteTipo.nota_venta
        ? VentaTipoComprobante.nota_venta
        : receipt.tipo === PlataformaComprobanteTipo.boleta
          ? VentaTipoComprobante.boleta
          : receipt.tipo === PlataformaComprobanteTipo.factura
            ? VentaTipoComprobante.factura
            : receipt.receptorTipoDocumento === '6'
              ? VentaTipoComprobante.nota_credito_factura
              : VentaTipoComprobante.nota_credito_boleta;
    const status: Record<PlataformaComprobanteEstado, SunatEstado> = {
      pendiente: SunatEstado.pendiente_envio,
      aceptado: SunatEstado.aceptado,
      rechazado: SunatEstado.rechazado,
      error: SunatEstado.error_definitivo,
      anulacion_pendiente: SunatEstado.pendiente_envio,
      anulado: SunatEstado.no_aplica,
    };
    const logoSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="150" viewBox="0 0 640 150"><text x="8" y="112" font-family="Arial,sans-serif" font-size="124" font-weight="800" fill="#082566">Nobi</text><text x="292" y="112" font-family="Arial,sans-serif" font-size="124" font-weight="800" fill="#ff7100">Tex</text><rect x="12" y="122" width="18" height="18" fill="#ff7100"/><rect x="40" y="130" width="18" height="18" fill="#ff7100"/></svg>';

    return this.salesPdf.generateCommercialDocumentPdf({
      issuer: {
        name: issuer?.razonSocial || issuer?.nombreComercial || 'Nuvex',
        tradeName: issuer?.nombreComercial || 'Nuvex',
        ruc: issuer?.ruc ?? null,
        address: issuer?.direccion ?? null,
        environment: issuer?.ambiente ?? 'BETA',
        logoSvg,
      },
      customer: {
        name: receipt.receptorNombre,
        document: receipt.receptorDocumento,
        documentType:
          receipt.receptorTipoDocumento === '6'
            ? ClienteTipoDocumento.ruc
            : receipt.receptorTipoDocumento === '1'
              ? ClienteTipoDocumento.dni
              : ClienteTipoDocumento.sin_documento,
        address: receipt.receptorDireccion,
      },
      type,
      series: receipt.serie,
      number: receipt.numero,
      issuedAt: receipt.fechaEmision,
      sunatStatus: status[receipt.estado],
      sunatCode: receipt.sunatCodigo,
      items: receipt.detalles.map((line) => ({
        description: line.descripcion,
        quantity: line.cantidad,
        unitPrice: line.precioUnitario,
        total: line.total,
      })),
      baseAmount: receipt.baseImponible,
      igv: receipt.igv,
      igvPercent: issuer?.igvPorcentaje ?? new Prisma.Decimal(18),
      total: receipt.total,
      paymentLabel: this.receiptPaymentLabel(receipt),
    });
  }
  private mapReceipt(row: Receipt) {
    return {
      id: row.id.toString(),
      requestId: row.requestId,
      company: {
        id: row.empresa.id.toString(),
        name: row.empresa.nombreComercial,
      },
      type: row.tipo,
      series: row.serie,
      number: row.numero,
      correlativo: `${row.serie}-${String(row.numero).padStart(8, '0')}`,
      issuedAt: row.fechaEmision.toISOString(),
      receiver: {
        documentType: row.receptorTipoDocumento,
        document: row.receptorDocumento,
        name: row.receptorNombre,
        address: row.receptorDireccion,
      },
      baseAmount: row.baseImponible.toFixed(2),
      igv: row.igv.toFixed(2),
      total: row.total.toFixed(2),
      currency: row.moneda,
      status: row.estado,
      sunatCode: row.sunatCodigo,
      sunatMessage: row.sunatMensaje,
      downloads: {
        pdf: true,
        xml: Boolean(row.xmlR2Key),
        cdr: Boolean(row.cdrR2Key),
        cancellationXml: Boolean(row.sunatBajaXmlR2Key),
        cancellationCdr: Boolean(row.sunatBajaCdrR2Key),
      },
      cancellation: row.sunatBajaEstado
        ? {
            state: row.sunatBajaEstado,
            type: row.sunatBajaTipo,
            code: row.sunatBajaCodigo,
            message: row.sunatBajaMensaje,
            ticket: row.sunatBajaTicket,
            requestedAt: row.sunatBajaSolicitadaAt?.toISOString() ?? null,
            respondedAt: row.sunatBajaRespondidaAt?.toISOString() ?? null,
          }
        : null,
      source: row.pagoSuscripcionId
        ? { type: 'subscription', id: row.pagoSuscripcionId.toString() }
        : row.suscripcionAsistenciaId
          ? {
              type: 'attendance-subscription',
              id: row.suscripcionAsistenciaId.toString(),
            }
          : row.liquidacionExcedenteId
            ? { type: 'overage', id: row.liquidacionExcedenteId.toString() }
            : row.cobroAdicionalId
              ? { type: 'extra', id: row.cobroAdicionalId.toString() }
              : {
                  type: 'credit-note',
                  id: row.comprobanteOrigenId?.toString(),
                },
      details: row.detalles.map((line) => ({
        id: line.id.toString(),
        description: line.descripcion,
        quantity: line.cantidad.toFixed(3),
        unitPrice: line.precioUnitario.toFixed(2),
        total: line.total.toFixed(2),
      })),
    };
  }

  private mapConfig(
    config: Awaited<
      ReturnType<
        PrismaService['configuracionFacturacionPlataforma']['findUnique']
      >
    >,
  ) {
    return config
      ? {
          ruc: config.ruc,
          businessName: config.razonSocial,
          tradeName: config.nombreComercial,
          address: config.direccion,
          ubigeo: config.ubigeo,
          environment: config.ambiente,
          igvPercent: config.igvPorcentaje.toFixed(2),
          active: config.activo,
          solUserConfigured: Boolean(config.usuarioSolEncrypted),
          solPasswordConfigured: Boolean(config.claveSolEncrypted),
          certificate: config.certificadoR2Key
            ? {
                name: config.certificadoNombre,
                sizeBytes: config.certificadoSizeBytes,
                uploadedAt: config.certificadoUploadedAt?.toISOString(),
              }
            : null,
          updatedAt: config.updatedAt.toISOString(),
        }
      : {
          ruc: null,
          businessName: null,
          tradeName: null,
          address: null,
          ubigeo: null,
          environment: 'BETA',
          igvPercent: '18.00',
          active: false,
          solUserConfigured: false,
          solPasswordConfigured: false,
          certificate: null,
          updatedAt: null,
        };
  }

  private async audit(
    usuarioId: bigint,
    empresaId: bigint | null,
    action: string,
    description: string,
    metadata: Prisma.InputJsonValue,
  ) {
    await this.prisma.platformAuditLog.create({
      data: {
        usuarioId,
        empresaId,
        category: 'billing',
        action,
        source: 'admin',
        description,
        metadata,
      },
    });
  }
  private encrypt(value: string) {
    return value.trim() ? this.secrets.encrypt(value.trim()) : null;
  }
  private receiptPaymentLabel(receipt: Receipt) {
    const source =
      receipt.pagoSuscripcion ??
      receipt.suscripcionAsistencia ??
      receipt.liquidacionExcedente ??
      receipt.cobroAdicional;
    if (!source?.metodoPago) return 'Contado';
    return source.metodoPago === 'otro'
      ? source.metodoPagoOtro || 'Otro'
      : source.metodoPago.charAt(0).toUpperCase() +
          source.metodoPago.slice(1).replace('_', ' ');
  }
  private typeLabel(type: PlataformaComprobanteTipo) {
    return (
      {
        nota_venta: 'Nota de venta',
        boleta: 'Boleta',
        factura: 'Factura',
        nota_credito: 'Nota de credito',
      } as const
    )[type];
  }
  private id(value: string, label: string) {
    try {
      const id = BigInt(value);
      if (id <= 0n) throw new Error();
      return id;
    } catch {
      throw new BadRequestException(`Identificador de ${label} invalido`);
    }
  }
  private serializable<T>(callback: (tx: Tx) => Promise<T>) {
    return this.prisma.$transaction(callback, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  }

  private limaDate(value: Date) {
    const ymd = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Lima',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(value);
    return new Date(`${ymd}T00:00:00.000Z`);
  }
}

export function calculateIncludedTax(
  total: Prisma.Decimal,
  percent: Prisma.Decimal,
) {
  const base = total
    .div(new Prisma.Decimal(1).add(percent.div(100)))
    .toDecimalPlaces(2);
  return { base, igv: total.sub(base).toDecimalPlaces(2) };
}

export function platformCancellationType(tipo: PlataformaComprobanteTipo) {
  if (tipo === PlataformaComprobanteTipo.factura) return SunatBajaTipo.RA;
  if (tipo === PlataformaComprobanteTipo.boleta) return SunatBajaTipo.RC;
  return null;
}
