import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SunatEstado, VentaTipoComprobante } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  scopedCreatorId,
  type CommercialScope,
} from '../../common/commercial-access';
import { resolveHistoryDateRange } from '../../common/history-date-range';
import {
  CreateDebitNoteDto,
  FindDebitNotesQueryDto,
} from './dto/debit-note.dto';

const include = {
  ventaReferencia: {
    select: {
      publicId: true,
      correlativo: true,
      tipoComprobante: true,
      serie: true,
      numero: true,
      total: true,
      createdAt: true,
    },
  },
  cliente: {
    select: {
      id: true,
      nombre: true,
      razonSocial: true,
      tipoDocumento: true,
      numeroDocumento: true,
    },
  },
  sucursal: { select: { id: true, nombre: true } },
  serieComprobante: {
    select: { id: true, serie: true, tipoComprobante: true },
  },
  detalles: {
    include: {
      ventaDetalleReferencia: {
        select: { id: true, descripcion: true, cantidad: true },
      },
    },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.NotaDebitoInclude;

type DebitNote = Prisma.NotaDebitoGetPayload<{ include: typeof include }>;

@Injectable()
export class DebitNotesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(empresaId: bigint, userId: string, dto: CreateDebitNoteDto) {
    const sale = await this.prisma.venta.findFirst({
      where: { empresaId, publicId: dto.ventaPublicId },
      include: {
        empresa: { include: { billingIntegration: true } },
        cliente: true,
        detalles: { orderBy: { id: 'asc' } },
      },
    });
    if (!sale)
      throw new NotFoundException('Comprobante original no encontrado');
    if (!sale.empresa.billingMicroserviceEnabled) {
      throw new BadRequestException(
        'Las notas de debito requieren la integracion con Nuvex Billing',
      );
    }
    const integration = sale.empresa.billingIntegration;
    if (!integration || integration.status !== 'READY') {
      throw new BadRequestException('La integracion Billing no esta lista');
    }
    if (
      sale.tipoComprobante !== VentaTipoComprobante.factura &&
      sale.tipoComprobante !== VentaTipoComprobante.boleta
    ) {
      throw new BadRequestException(
        'Solo se pueden modificar facturas o boletas',
      );
    }
    if (
      !sale.billingDocumentId ||
      !sale.billingEnvironment ||
      !['ACCEPTED', 'ACCEPTED_WITH_OBSERVATIONS'].includes(
        sale.billingStatus ?? '',
      )
    ) {
      throw new BadRequestException(
        'El comprobante original debe estar aceptado por Billing',
      );
    }
    if (sale.billingEnvironment !== integration.environment) {
      throw new BadRequestException(
        'El comprobante pertenece a otro ambiente Billing',
      );
    }
    if (!sale.clienteId || !sale.cliente) {
      throw new BadRequestException(
        'La nota de debito requiere un cliente identificado',
      );
    }
    if (!sale.numero || !sale.serie || !sale.correlativo) {
      throw new BadRequestException(
        'El comprobante original no tiene numeracion fiscal',
      );
    }
    const clienteId = sale.clienteId;
    const numeroReferencia = sale.numero;
    const correlativoReferencia = sale.correlativo;
    if (!dto.ajustes.length) {
      throw new BadRequestException('Debe agregar al menos un concepto');
    }
    const duplicated = dto.ajustes
      .map((item) => item.ventaDetalleId)
      .filter((id, index, all) => all.indexOf(id) !== index);
    if (duplicated.length) {
      throw new BadRequestException(
        'Cada linea original solo puede seleccionarse una vez',
      );
    }

    const type =
      sale.tipoComprobante === VentaTipoComprobante.factura
        ? VentaTipoComprobante.nota_debito_factura
        : VentaTipoComprobante.nota_debito_boleta;
    const series = await this.prisma.serieComprobante.findFirst({
      where: {
        empresaId,
        tipoComprobante: type,
        activo: true,
        ...(dto.serieId ? { id: BigInt(dto.serieId) } : {}),
        ...(dto.serie ? { serie: dto.serie.toUpperCase() } : {}),
      },
      orderBy: [{ esPrincipal: 'desc' }, { serie: 'asc' }],
    });
    if (!series)
      throw new NotFoundException('No existe una serie FD/BD activa');
    const expectedPrefix = sale.tipoComprobante === 'factura' ? 'F' : 'B';
    if (!series.serie.startsWith(expectedPrefix)) {
      throw new BadRequestException(
        `La serie debe iniciar con ${expectedPrefix}`,
      );
    }
    const [seriesMapping, establishmentMapping] = await Promise.all([
      this.prisma.billingSeriesMapping.findUnique({
        where: {
          serieComprobanteId_environment: {
            serieComprobanteId: series.id,
            environment: integration.environment,
          },
        },
      }),
      sale.sucursalId
        ? this.prisma.billingEstablishmentMapping.findUnique({
            where: {
              sucursalId_environment: {
                sucursalId: sale.sucursalId,
                environment: integration.environment,
              },
            },
          })
        : null,
    ]);
    if (!seriesMapping) {
      throw new BadRequestException(
        'La serie de nota de debito no esta sincronizada con Billing',
      );
    }
    if (!establishmentMapping) {
      throw new BadRequestException(
        'La sucursal no esta sincronizada con Billing',
      );
    }

    const saleLines = new Map(
      sale.detalles.map((line) => [line.id.toString(), line]),
    );
    const lines = dto.ajustes.map((adjustment) => {
      const source = saleLines.get(adjustment.ventaDetalleId);
      if (!source)
        throw new BadRequestException(
          'Una linea no pertenece al comprobante original',
        );
      const amount = new Prisma.Decimal(adjustment.importe).toDecimalPlaces(2);
      if (!amount.isPositive())
        throw new BadRequestException('El importe debe ser mayor a cero');
      const taxable = source.tipoAfectacionIgvCodigo === '10';
      const value = taxable ? amount.div('1.18').toDecimalPlaces(2) : amount;
      return {
        source,
        description: adjustment.descripcion.trim(),
        amount,
        value,
        tax: amount.minus(value).toDecimalPlaces(2),
      };
    });
    const sum = (pick: (line: (typeof lines)[number]) => Prisma.Decimal) =>
      lines.reduce(
        (total, line) => total.plus(pick(line)),
        new Prisma.Decimal(0),
      );
    const opGravadas = sum((line) =>
      line.source.tipoAfectacionIgvCodigo === '10'
        ? line.value
        : new Prisma.Decimal(0),
    );
    const opExoneradas = sum((line) =>
      line.source.tipoAfectacionIgvCodigo === '20'
        ? line.value
        : new Prisma.Decimal(0),
    );
    const opInafectas = sum((line) =>
      line.source.tipoAfectacionIgvCodigo === '30'
        ? line.value
        : new Prisma.Decimal(0),
    );
    const total = sum((line) => line.amount);
    const tax = sum((line) => line.tax);

    const created = await this.prisma.$transaction(async (tx) => {
      const note = await tx.notaDebito.create({
        data: {
          empresaId,
          ventaReferenciaId: sale.id,
          sucursalId: sale.sucursalId,
          clienteId,
          serieComprobanteId: series.id,
          creadoPorId: BigInt(userId),
          tipoComprobante: type,
          serie: series.serie,
          moneda: sale.moneda,
          codigoMotivo: dto.codigoMotivo,
          descripcionMotivo: dto.descripcionMotivo.trim(),
          tipoDocumentoRef: sale.tipoComprobante === 'factura' ? '01' : '03',
          serieRef: sale.serie,
          numeroRef: numeroReferencia,
          correlativoRef: correlativoReferencia,
          fechaVencimiento: new Date(`${dto.fechaVencimiento}T00:00:00.000Z`),
          opGravadas,
          opExoneradas,
          opInafectas,
          igvMonto: tax,
          total,
          billingEnvironment: integration.environment,
          billingUpdatedAt: new Date(),
          detalles: {
            create: lines.map((line) => ({
              ventaDetalleReferenciaId: line.source.id,
              descripcion: line.description,
              importe: line.amount,
              valorVenta: line.value,
              igvMonto: line.tax,
              tipoAfectacionIgvCodigo: line.source.tipoAfectacionIgvCodigo,
            })),
          },
        },
        include,
      });
      await tx.billingDebitNoteOutbox.create({
        data: {
          empresaId,
          notaDebitoId: note.id,
          environment: integration.environment,
          idempotencyKey: `nuvex:${integration.environment.toLowerCase()}:debit-note:${note.publicId}:issue`,
        },
      });
      return note;
    });
    return this.response(created);
  }

  async findEligibleSales(empresaId: bigint, search?: string) {
    const data = await this.prisma.venta.findMany({
      where: {
        empresaId,
        tipoComprobante: { in: ['factura', 'boleta'] },
        billingStatus: { in: ['ACCEPTED', 'ACCEPTED_WITH_OBSERVATIONS'] },
        clienteId: { not: null },
        ...(search?.trim()
          ? {
              OR: [
                {
                  correlativo: { contains: search.trim(), mode: 'insensitive' },
                },
                {
                  cliente: {
                    nombre: { contains: search.trim(), mode: 'insensitive' },
                  },
                },
                {
                  cliente: {
                    razonSocial: {
                      contains: search.trim(),
                      mode: 'insensitive',
                    },
                  },
                },
              ],
            }
          : {}),
      },
      include: { cliente: true, detalles: { orderBy: { id: 'asc' } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return data.map((sale) => ({
      publicId: sale.publicId,
      correlativo: sale.correlativo,
      tipoComprobante: sale.tipoComprobante,
      moneda: sale.moneda,
      total: sale.total.toFixed(2),
      cliente: sale.cliente
        ? {
            nombre: sale.cliente.razonSocial || sale.cliente.nombre,
            documento: sale.cliente.numeroDocumento,
          }
        : null,
      detalles: sale.detalles.map((line) => ({
        id: line.id.toString(),
        descripcion: line.descripcion,
        cantidad: line.cantidad,
        total: line.total.toFixed(2),
        tipoAfectacionIgvCodigo: line.tipoAfectacionIgvCodigo,
      })),
    }));
  }

  async findAll(
    empresaId: bigint,
    scope: CommercialScope,
    query: FindDebitNotesQueryDto,
  ) {
    const where: Prisma.NotaDebitoWhereInput = {
      empresaId,
      createdAt: resolveHistoryDateRange(query),
      ...(scope.branchId ? { sucursalId: scope.branchId } : {}),
      ...(scopedCreatorId(scope)
        ? { creadoPorId: scopedCreatorId(scope)! }
        : {}),
      ...(query.tipoComprobante
        ? { tipoComprobante: query.tipoComprobante }
        : {}),
      ...(query.sunatEstado ? { sunatEstado: query.sunatEstado } : {}),
      ...(query.search?.trim()
        ? {
            OR: [
              {
                correlativo: {
                  contains: query.search.trim(),
                  mode: 'insensitive',
                },
              },
              {
                correlativoRef: {
                  contains: query.search.trim(),
                  mode: 'insensitive',
                },
              },
              {
                cliente: {
                  nombre: {
                    contains: query.search.trim(),
                    mode: 'insensitive',
                  },
                },
              },
              {
                cliente: {
                  razonSocial: {
                    contains: query.search.trim(),
                    mode: 'insensitive',
                  },
                },
              },
            ],
          }
        : {}),
    };
    const page = query.page ?? 1;
    const limit = query.limit ?? 12;
    const [data, total, grouped, acceptedTotals] =
      await this.prisma.$transaction([
        this.prisma.notaDebito.findMany({
          where,
          include,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.prisma.notaDebito.count({ where }),
        this.prisma.notaDebito.groupBy({
          by: ['sunatEstado'],
          where,
          orderBy: { sunatEstado: 'asc' },
          _count: { _all: true },
        }),
        this.prisma.notaDebito.aggregate({
          where: { ...where, sunatEstado: SunatEstado.aceptado },
          _sum: { total: true },
        }),
      ]);

    const byStatus = new Map(
      grouped.map((item) => [
        item.sunatEstado,
        (item._count as { _all?: number } | undefined)?._all ?? 0,
      ]),
    );

    return {
      data: data.map((item) => this.response(item)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
      summary: {
        aceptados: byStatus.get(SunatEstado.aceptado) ?? 0,
        porEnviar:
          (byStatus.get(SunatEstado.pendiente_envio) ?? 0) +
          (byStatus.get(SunatEstado.enviando) ?? 0),
        observados: byStatus.get(SunatEstado.observado) ?? 0,
        rechazados: byStatus.get(SunatEstado.rechazado) ?? 0,
        errores:
          (byStatus.get(SunatEstado.error_transitorio) ?? 0) +
          (byStatus.get(SunatEstado.error_definitivo) ?? 0),
        montoAceptado: acceptedTotals._sum.total?.toString() ?? '0',
      },
    };
  }

  async findOne(empresaId: bigint, scope: CommercialScope, publicId: string) {
    const note = await this.prisma.notaDebito.findFirst({
      where: {
        empresaId,
        publicId,
        ...(scope.branchId ? { sucursalId: scope.branchId } : {}),
        ...(scopedCreatorId(scope)
          ? { creadoPorId: scopedCreatorId(scope)! }
          : {}),
      },
      include,
    });
    if (!note) throw new NotFoundException('Nota de debito no encontrada');
    return this.response(note);
  }

  private response(note: DebitNote) {
    return {
      publicId: note.publicId,
      tipoComprobante: note.tipoComprobante,
      serie: note.serie,
      numero: note.numero,
      correlativo: note.correlativo,
      codigoMotivo: note.codigoMotivo,
      descripcionMotivo: note.descripcionMotivo,
      fechaVencimiento: note.fechaVencimiento.toISOString().slice(0, 10),
      moneda: note.moneda,
      opGravadas: note.opGravadas.toFixed(2),
      opExoneradas: note.opExoneradas.toFixed(2),
      opInafectas: note.opInafectas.toFixed(2),
      igvMonto: note.igvMonto.toFixed(2),
      total: note.total.toFixed(2),
      createdAt: note.createdAt.toISOString(),
      cliente: {
        id: note.cliente.id.toString(),
        nombre: note.cliente.razonSocial || note.cliente.nombre,
        documento: note.cliente.numeroDocumento,
      },
      sucursal: note.sucursal
        ? { id: note.sucursal.id.toString(), nombre: note.sucursal.nombre }
        : null,
      ventaReferencia: {
        ...note.ventaReferencia,
        total: note.ventaReferencia.total.toFixed(2),
        createdAt: note.ventaReferencia.createdAt.toISOString(),
      },
      detalles: note.detalles.map((line) => ({
        id: line.id.toString(),
        ventaDetalleId: line.ventaDetalleReferenciaId.toString(),
        descripcion: line.descripcion,
        importe: line.importe.toFixed(2),
        valorVenta: line.valorVenta.toFixed(2),
        igvMonto: line.igvMonto.toFixed(2),
        tipoAfectacionIgvCodigo: line.tipoAfectacionIgvCodigo,
      })),
      sunat: {
        estado: note.sunatEstado,
        codigo: note.sunatCodigo,
        mensaje: note.sunatMensaje,
        enviadoAt: note.sunatEnviadoAt?.toISOString() ?? null,
        respondidoAt: note.sunatRespondidoAt?.toISOString() ?? null,
        archivosDisponibles: [
          'ACCEPTED',
          'ACCEPTED_WITH_OBSERVATIONS',
        ].includes(note.billingStatus),
      },
      billing: {
        documentId: note.billingDocumentId,
        environment: note.billingEnvironment,
        status: note.billingStatus,
        updatedAt: note.billingUpdatedAt?.toISOString() ?? null,
        lastError: note.billingLastError,
        attempts: note.billingAttempts,
      },
    };
  }
}
