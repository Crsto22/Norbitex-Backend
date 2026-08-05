import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SunatEstado,
  SunatJobTipoDocumento,
  VentaEstado,
  VentaTipoComprobante,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  scopedCreatorId,
  type CommercialScope,
} from '../../common/commercial-access';
import {
  CreateCreditNoteDto,
  FindCreditNotesQueryDto,
} from './dto/credit-note.dto';
import { resolveHistoryDateRange } from '../../common/history-date-range';

const creditNoteInclude = {
  ventaReferencia: {
    select: {
      publicId: true,
      correlativo: true,
      tipoComprobante: true,
      serie: true,
      numero: true,
      createdAt: true,
    },
  },
  sucursal: { select: { id: true, nombre: true } },
  cliente: {
    select: {
      id: true,
      nombre: true,
      razonSocial: true,
      tipoDocumento: true,
      numeroDocumento: true,
    },
  },
  serieComprobante: {
    select: { id: true, serie: true, tipoComprobante: true },
  },
  creadoPor: { select: { id: true, nombre: true, apellido: true } },
  detalles: {
    include: {
      productoVariante: {
        include: {
          producto: {
            select: { id: true, publicId: true, nombre: true, tipo: true },
          },
          productoColor: {
            include: {
              color: { select: { id: true, nombre: true, hex: true } },
              imagenes: {
                orderBy: [{ esPrincipal: 'desc' }, { orden: 'asc' }],
                take: 1,
                select: {
                  id: true,
                  urlOriginal: true,
                  urlWebp: true,
                  urlThumbnail: true,
                },
              },
            },
          },
          talla: { select: { id: true, nombre: true } },
        },
      },
      ventaDetalleReferencia: { select: { id: true } },
    },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.NotaCreditoInclude;

type CreditNoteWithRelations = Prisma.NotaCreditoGetPayload<{
  include: typeof creditNoteInclude;
}>;

const saleForCreditNoteInclude = {
  empresa: true,
  sucursal: true,
  cliente: true,
  detalles: {
    include: {
      productoVariante: {
        include: {
          producto: true,
        },
      },
    },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.VentaInclude;

type SaleForCreditNote = Prisma.VentaGetPayload<{
  include: typeof saleForCreditNoteInclude;
}>;

const DOCUMENTAL_MOTIVES = new Set(['02', '03']);
const ACTIVE_SUNAT_STATES = [
  SunatEstado.pendiente_envio,
  SunatEstado.enviando,
  SunatEstado.pendiente_cdr,
  SunatEstado.aceptado,
  SunatEstado.observado,
  SunatEstado.error_transitorio,
];

@Injectable()
export class CreditNotesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(empresaId: bigint, userId: string, dto: CreateCreditNoteDto) {
    const venta = await this.prisma.venta.findFirst({
      where: { empresaId, publicId: dto.ventaPublicId },
      include: saleForCreditNoteInclude,
    });

    if (!venta) {
      throw new NotFoundException('Venta no encontrada');
    }
    this.validateSale(venta);

    const serie = await this.resolveSerie(empresaId, venta, dto);
    const lines = await this.buildLines(venta, dto);

    const totals = this.sumLines(lines);
    const noteType =
      venta.tipoComprobante === VentaTipoComprobante.factura
        ? VentaTipoComprobante.nota_credito_factura
        : VentaTipoComprobante.nota_credito_boleta;

    const created = await this.prisma.$transaction(async (tx) => {
      const updatedSerie = await tx.serieComprobante.update({
        where: { id: serie.id },
        data: { numeroActual: { increment: 1 } },
      });
      const numero = updatedSerie.numeroActual;
      const correlativo = `${serie.serie}-${numero.toString().padStart(6, '0')}`;

      const note = await tx.notaCredito.create({
        data: {
          empresaId,
          ventaReferenciaId: venta.id,
          sucursalId: venta.sucursalId,
          clienteId: venta.clienteId,
          serieComprobanteId: serie.id,
          creadoPorId: BigInt(userId),
          tipoComprobante: noteType,
          serie: serie.serie,
          numero,
          correlativo,
          moneda: venta.moneda,
          codigoMotivo: dto.codigoMotivo,
          descripcionMotivo: this.clean(dto.descripcionMotivo, 255),
          tipoDocumentoRef:
            venta.tipoComprobante === VentaTipoComprobante.factura
              ? '01'
              : '03',
          serieRef: venta.serie,
          numeroRef: venta.numero,
          correlativoRef: venta.correlativo,
          subtotal: totals.subtotal,
          descuentoMonto: totals.descuentoMonto,
          igvPorcentaje: venta.igvPorcentaje,
          opGravadas: totals.opGravadas,
          opExoneradas: totals.opExoneradas,
          opInafectas: totals.opInafectas,
          igvMonto: totals.igvMonto,
          total: totals.total,
          detalles: {
            create: lines.map((line) => ({
              ventaDetalleReferenciaId: line.ventaDetalleId,
              productoVarianteId: line.productoVarianteId,
              descripcion: line.descripcion,
              cantidad: line.cantidad,
              unidadMedidaCodigo: line.unidadMedidaCodigo,
              tipoAfectacionIgvCodigo: line.tipoAfectacionIgvCodigo,
              precioUnitario: line.precioUnitario,
              valorUnitario: line.valorUnitario,
              descuentoMonto: line.descuentoMonto,
              valorVenta: line.valorVenta,
              igvMonto: line.igvMonto,
              subtotal: line.subtotal,
              total: line.total,
            })),
          },
        },
        include: creditNoteInclude,
      });

      await tx.sunatJob.upsert({
        where: {
          tipoDocumento_documentoId: {
            tipoDocumento: SunatJobTipoDocumento.nota_credito,
            documentoId: note.id,
          },
        },
        create: {
          empresaId,
          tipoDocumento: SunatJobTipoDocumento.nota_credito,
          documentoId: note.id,
          estado: 'pendiente_envio',
          nextRetryAt: new Date(),
        },
        update: {
          estado: 'pendiente_envio',
          intentos: 0,
          ultimoCodigo: null,
          ultimoError: null,
          lockedAt: null,
          lastAttemptAt: null,
          processedAt: null,
          nextRetryAt: new Date(),
        },
      });

      return note;
    });

    return this.toResponse(created);
  }

  async findAll(
    empresaId: bigint,
    scope: CommercialScope,
    query: FindCreditNotesQueryDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 12;
    const search = query.search?.trim();
    const where: Prisma.NotaCreditoWhereInput = {
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
      ...(query.clienteId ? { clienteId: BigInt(query.clienteId) } : {}),
      ...(query.ventaPublicId
        ? { ventaReferencia: { publicId: query.ventaPublicId } }
        : {}),
      ...(search
        ? {
            OR: [
              { correlativo: { contains: search, mode: 'insensitive' } },
              { correlativoRef: { contains: search, mode: 'insensitive' } },
              { sunatCodigo: { contains: search, mode: 'insensitive' } },
              {
                cliente: { nombre: { contains: search, mode: 'insensitive' } },
              },
              {
                cliente: {
                  razonSocial: { contains: search, mode: 'insensitive' },
                },
              },
              {
                cliente: {
                  numeroDocumento: { contains: search, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };

    const [data, total, grouped, acceptedTotals] =
      await this.prisma.$transaction([
        this.prisma.notaCredito.findMany({
          where,
          include: creditNoteInclude,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.prisma.notaCredito.count({ where }),
        this.prisma.notaCredito.groupBy({
          by: ['sunatEstado'],
          where,
          orderBy: { sunatEstado: 'asc' },
          _count: { _all: true },
        }),
        this.prisma.notaCredito.aggregate({
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
      data: data.map((note) => this.toResponse(note)),
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
    const note = await this.prisma.notaCredito.findFirst({
      where: {
        empresaId,
        publicId,
        ...(scope.branchId ? { sucursalId: scope.branchId } : {}),
        ...(scopedCreatorId(scope)
          ? { creadoPorId: scopedCreatorId(scope)! }
          : {}),
      },
      include: creditNoteInclude,
    });

    if (!note) {
      throw new NotFoundException('Nota de credito no encontrada');
    }

    return this.toResponse(note);
  }

  private validateSale(venta: SaleForCreditNote) {
    if (
      venta.tipoComprobante !== VentaTipoComprobante.factura &&
      venta.tipoComprobante !== VentaTipoComprobante.boleta
    ) {
      throw new BadRequestException(
        'Solo se puede emitir nota de credito para factura o boleta',
      );
    }
    if (venta.estado === VentaEstado.anulada) {
      throw new BadRequestException('La venta ya esta anulada');
    }
    if (!venta.cliente) {
      throw new BadRequestException('La venta debe tener cliente');
    }
    if (!venta.serie || !venta.numero) {
      throw new BadRequestException(
        'La venta no tiene numeracion electronica valida',
      );
    }
  }

  private async resolveSerie(
    empresaId: bigint,
    venta: SaleForCreditNote,
    dto: CreateCreditNoteDto,
  ) {
    const tipoComprobante =
      venta.tipoComprobante === VentaTipoComprobante.factura
        ? VentaTipoComprobante.nota_credito_factura
        : VentaTipoComprobante.nota_credito_boleta;
    const where: Prisma.SerieComprobanteWhereInput = {
      empresaId,
      tipoComprobante,
      activo: true,
      ...(dto.serieId ? { id: BigInt(dto.serieId) } : {}),
      ...(dto.serie ? { serie: dto.serie.toUpperCase() } : {}),
    };
    const serie = await this.prisma.serieComprobante.findFirst({
      where,
      orderBy: [{ esPrincipal: 'desc' }, { serie: 'asc' }],
    });

    if (!serie) {
      throw new NotFoundException(
        'No se encontro serie activa para nota de credito',
      );
    }

    const prefix =
      venta.tipoComprobante === VentaTipoComprobante.factura ? 'F' : 'B';
    if (!serie.serie.toUpperCase().startsWith(prefix)) {
      throw new BadRequestException(
        `La serie de nota de credito debe iniciar con ${prefix}`,
      );
    }

    return serie;
  }

  private async buildLines(venta: SaleForCreditNote, dto: CreateCreditNoteDto) {
    if (DOCUMENTAL_MOTIVES.has(dto.codigoMotivo) && dto.items?.length) {
      throw new BadRequestException('Este motivo no acepta items');
    }
    if (dto.codigoMotivo === '06' && dto.items?.length) {
      throw new BadRequestException('La devolucion total no requiere items');
    }
    if (dto.codigoMotivo === '07' && !dto.items?.length) {
      throw new BadRequestException(
        'La devolucion parcial requiere al menos un item',
      );
    }

    if (DOCUMENTAL_MOTIVES.has(dto.codigoMotivo)) {
      return venta.detalles.map((detalle) =>
        this.lineFromSaleDetail(detalle, detalle.cantidad),
      );
    }

    const availableByDetail = await this.availableQuantities(venta);
    if (dto.codigoMotivo === '06') {
      const lines = venta.detalles
        .map((detalle) =>
          this.lineFromSaleDetail(
            detalle,
            availableByDetail.get(detalle.id.toString()) ?? 0,
          ),
        )
        .filter((line) => line.cantidad > 0);
      if (!lines.length) {
        throw new BadRequestException(
          'La venta ya no tiene saldo disponible para devolver',
        );
      }
      return lines;
    }

    const details = new Map(
      venta.detalles.map((detalle) => [detalle.id.toString(), detalle]),
    );
    return (dto.items ?? []).map((item) => {
      const detalle = details.get(item.ventaDetalleId);
      if (!detalle) {
        throw new BadRequestException(
          'Uno de los items no pertenece a la venta',
        );
      }
      const available = availableByDetail.get(item.ventaDetalleId) ?? 0;
      if (item.cantidad > available) {
        throw new BadRequestException(
          'La cantidad solicitada excede el saldo disponible',
        );
      }
      return this.lineFromSaleDetail(detalle, item.cantidad);
    });
  }

  private async availableQuantities(venta: SaleForCreditNote) {
    const credited = await this.prisma.notaCreditoDetalle.groupBy({
      by: ['ventaDetalleReferenciaId'],
      where: {
        ventaDetalleReferencia: { ventaId: venta.id },
        notaCredito: {
          sunatEstado: { in: ACTIVE_SUNAT_STATES },
          codigoMotivo: { in: ['06', '07'] },
        },
      },
      _sum: { cantidad: true },
    });
    const creditedMap = new Map(
      credited.map((item) => [
        item.ventaDetalleReferenciaId?.toString() ?? '',
        item._sum.cantidad ?? 0,
      ]),
    );

    return new Map(
      venta.detalles.map((detalle) => [
        detalle.id.toString(),
        Math.max(
          0,
          detalle.cantidad - (creditedMap.get(detalle.id.toString()) ?? 0),
        ),
      ]),
    );
  }

  private lineFromSaleDetail(
    detalle: SaleForCreditNote['detalles'][number],
    cantidad: number,
  ) {
    if (cantidad <= 0) {
      return {
        ventaDetalleId: detalle.id,
        productoVarianteId: detalle.productoVarianteId,
        descripcion:
          detalle.descripcion ?? detalle.productoVariante.producto.nombre,
        cantidad,
        unidadMedidaCodigo: detalle.unidadMedidaCodigo,
        tipoAfectacionIgvCodigo: detalle.tipoAfectacionIgvCodigo,
        precioUnitario: detalle.precioUnitario,
        valorUnitario: detalle.valorUnitario,
        descuentoMonto: new Prisma.Decimal(0),
        valorVenta: new Prisma.Decimal(0),
        igvMonto: new Prisma.Decimal(0),
        subtotal: new Prisma.Decimal(0),
        total: new Prisma.Decimal(0),
      };
    }
    const factor = new Prisma.Decimal(cantidad).div(detalle.cantidad);
    return {
      ventaDetalleId: detalle.id,
      productoVarianteId: detalle.productoVarianteId,
      descripcion:
        detalle.descripcion ?? detalle.productoVariante.producto.nombre,
      cantidad,
      unidadMedidaCodigo: detalle.unidadMedidaCodigo,
      tipoAfectacionIgvCodigo: detalle.tipoAfectacionIgvCodigo,
      precioUnitario: detalle.precioUnitario,
      valorUnitario: detalle.valorUnitario,
      descuentoMonto: detalle.descuentoMonto.mul(factor).toDecimalPlaces(2),
      valorVenta: detalle.valorVenta.mul(factor).toDecimalPlaces(2),
      igvMonto: detalle.igvMonto.mul(factor).toDecimalPlaces(2),
      subtotal: detalle.subtotal.mul(factor).toDecimalPlaces(2),
      total: detalle.total.mul(factor).toDecimalPlaces(2),
    };
  }

  private sumLines(
    lines: ReturnType<CreditNotesService['lineFromSaleDetail']>[],
  ) {
    const zero = new Prisma.Decimal(0);
    const sum = (
      field:
        | 'descuentoMonto'
        | 'valorVenta'
        | 'igvMonto'
        | 'subtotal'
        | 'total',
    ) =>
      lines
        .reduce((total, line) => total.add(line[field]), zero)
        .toDecimalPlaces(2);

    const opGravadas = lines
      .filter((line) => line.tipoAfectacionIgvCodigo === '10')
      .reduce((total, line) => total.add(line.valorVenta), zero)
      .toDecimalPlaces(2);
    const opExoneradas = lines
      .filter((line) => line.tipoAfectacionIgvCodigo === '20')
      .reduce((total, line) => total.add(line.valorVenta), zero)
      .toDecimalPlaces(2);
    const opInafectas = lines
      .filter((line) => line.tipoAfectacionIgvCodigo === '30')
      .reduce((total, line) => total.add(line.valorVenta), zero)
      .toDecimalPlaces(2);

    return {
      subtotal: sum('subtotal'),
      descuentoMonto: sum('descuentoMonto'),
      igvMonto: sum('igvMonto'),
      total: sum('total'),
      opGravadas,
      opExoneradas,
      opInafectas,
    };
  }

  private clean(value: string, max: number) {
    const clean = value.trim().replace(/\s+/g, ' ');
    if (!clean || clean.length < 5) {
      throw new BadRequestException(
        'La descripcion del motivo debe tener al menos 5 caracteres',
      );
    }
    return clean.slice(0, max);
  }

  private toResponse(note: CreditNoteWithRelations) {
    return {
      publicId: note.publicId,
      correlativo: note.correlativo,
      tipoComprobante: note.tipoComprobante,
      serie: note.serie,
      numero: note.numero,
      codigoMotivo: note.codigoMotivo,
      descripcionMotivo: note.descripcionMotivo,
      moneda: note.moneda,
      subtotal: note.subtotal.toString(),
      descuentoMonto: note.descuentoMonto.toString(),
      igvPorcentaje: note.igvPorcentaje.toString(),
      opGravadas: note.opGravadas.toString(),
      opExoneradas: note.opExoneradas.toString(),
      opInafectas: note.opInafectas.toString(),
      igvMonto: note.igvMonto.toString(),
      total: note.total.toString(),
      estado: note.estado,
      stockDevuelto: note.stockDevuelto,
      sunat: {
        estado: note.sunatEstado,
        codigo: note.sunatCodigo,
        mensaje: note.sunatMensaje,
        hash: note.sunatHash,
        xmlDisponible: Boolean(note.sunatXmlKey),
        cdrDisponible: Boolean(note.sunatCdrKey),
        enviadoAt: note.sunatEnviadoAt?.toISOString() ?? null,
        respondidoAt: note.sunatRespondidoAt?.toISOString() ?? null,
      },
      ventaReferencia: {
        publicId: note.ventaReferencia.publicId,
        correlativo: note.ventaReferencia.correlativo,
        tipoComprobante: note.ventaReferencia.tipoComprobante,
        serie: note.ventaReferencia.serie,
        numero: note.ventaReferencia.numero,
        createdAt: note.ventaReferencia.createdAt.toISOString(),
      },
      sucursal: note.sucursal
        ? { id: note.sucursal.id.toString(), nombre: note.sucursal.nombre }
        : null,
      cliente: note.cliente
        ? {
            id: note.cliente.id.toString(),
            nombre:
              note.cliente.razonSocial || note.cliente.nombre || 'Cliente',
            tipoDocumento: note.cliente.tipoDocumento,
            numeroDocumento: note.cliente.numeroDocumento,
          }
        : null,
      serieComprobante: {
        id: note.serieComprobante.id.toString(),
        serie: note.serieComprobante.serie,
        tipoComprobante: note.serieComprobante.tipoComprobante,
      },
      creadoPor: note.creadoPor
        ? {
            id: note.creadoPor.id.toString(),
            nombre: note.creadoPor.nombre,
            apellido: note.creadoPor.apellido,
          }
        : null,
      detalles: note.detalles.map((detail) => {
        const image = detail.productoVariante.productoColor.imagenes[0];
        return {
          id: detail.id.toString(),
          ventaDetalleId: detail.ventaDetalleReferencia?.id.toString() ?? null,
          descripcion: detail.descripcion,
          cantidad: detail.cantidad,
          unidadMedidaCodigo: detail.unidadMedidaCodigo,
          tipoAfectacionIgvCodigo: detail.tipoAfectacionIgvCodigo,
          precioUnitario: detail.precioUnitario.toString(),
          valorUnitario: detail.valorUnitario.toString(),
          descuentoMonto: detail.descuentoMonto.toString(),
          valorVenta: detail.valorVenta.toString(),
          igvMonto: detail.igvMonto.toString(),
          subtotal: detail.subtotal.toString(),
          total: detail.total.toString(),
          productoVariante: {
            id: detail.productoVariante.id.toString(),
            sku: detail.productoVariante.sku,
            producto: {
              id: detail.productoVariante.producto.id.toString(),
              publicId: detail.productoVariante.producto.publicId,
              nombre: detail.productoVariante.producto.nombre,
              tipo: detail.productoVariante.producto.tipo,
            },
            color: {
              id: detail.productoVariante.productoColor.color.id.toString(),
              nombre: detail.productoVariante.productoColor.color.nombre,
              hex: detail.productoVariante.productoColor.color.hex,
            },
            talla: {
              id: detail.productoVariante.talla.id.toString(),
              nombre: detail.productoVariante.talla.nombre,
            },
            imagen: image
              ? {
                  id: image.id.toString(),
                  urlOriginal: image.urlOriginal,
                  urlWebp: image.urlWebp,
                  urlThumbnail: image.urlThumbnail,
                }
              : null,
          },
        };
      }),
      createdAt: note.createdAt.toISOString(),
      updatedAt: note.updatedAt.toISOString(),
    };
  }
}
