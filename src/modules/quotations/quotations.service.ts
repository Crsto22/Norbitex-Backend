import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CotizacionEstado, Prisma, SucursalTipo } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  resolveScopedBranchId,
  scopedCreatorId,
  type CommercialScope,
} from '../../common/commercial-access';
import { parseUnitPrice } from '../../common/unit-price';
import { SalesService } from '../sales/sales.service';
import { CreateQuotationDto } from './dto/create-quotation.dto';
import { FindQuotationsQueryDto } from './dto/find-quotations-query.dto';
import { resolveHistoryDateRange } from '../../common/history-date-range';
import { UpdateQuotationDto } from './dto/update-quotation.dto';
import { AnnulQuotationDto } from './dto/annul-quotation.dto';
import { ConvertQuotationToSaleDto } from './dto/convert-quotation-to-sale.dto';

const quotationInclude = {
  sucursal: { select: { id: true, nombre: true } },
  cliente: {
    select: {
      id: true,
      empresaId: true,
      nombre: true,
      razonSocial: true,
      tipoDocumento: true,
      numeroDocumento: true,
      telefono: true,
      email: true,
      direccion: true,
      ubigeo: true,
      distrito: true,
      estado: true,
      createdAt: true,
      updatedAt: true,
    },
  },
  creadoPor: { select: { id: true, nombre: true, apellido: true } },
  convertidaVenta: {
    select: { id: true, publicId: true, correlativo: true },
  },
  detalles: {
    include: {
      productoVariante: {
        include: {
          producto: {
            select: { id: true, nombre: true, publicId: true, tipo: true },
          },
          productoColor: {
            include: {
              color: { select: { id: true, nombre: true, hex: true } },
              imagenes: {
                orderBy: [{ esPrincipal: 'desc' }, { orden: 'asc' }],
                take: 1,
              },
            },
          },
          talla: { select: { id: true, nombre: true } },
        },
      },
    },
  },
} satisfies Prisma.CotizacionInclude;

type QuotationWithRelations = Prisma.CotizacionGetPayload<{
  include: typeof quotationInclude;
}>;

type QuotationDetalleInput = CreateQuotationDto['detalles'][number];

@Injectable()
export class QuotationsService {
  private readonly defaultSerie = 'COT1';

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly salesService: SalesService,
  ) {}

  async create(
    empresaId: bigint,
    scope: CommercialScope,
    dto: CreateQuotationDto,
  ) {
    const effectiveBranchId = resolveScopedBranchId(scope, dto.sucursalId);
    dto.sucursalId = effectiveBranchId?.toString();
    const userId = scope.userId.toString();
    const usuarioId = BigInt(userId);
    await this.validateHeaderReferences(
      empresaId,
      dto.sucursalId,
      dto.clienteId,
    );
    this.ensureEditableState(dto.estado);

    const totals = await this.buildTotals(empresaId, dto.detalles, {
      descuentoTipo: dto.descuentoTipo,
      descuentoValor: dto.descuentoValor,
    });

    const quotation = await this.prisma.$transaction(async (tx) => {
      const lastQuotation = await tx.cotizacion.findFirst({
        where: { empresaId, serie: this.defaultSerie },
        orderBy: { numero: 'desc' },
        select: { numero: true },
      });
      const numero = (lastQuotation?.numero ?? 0) + 1;
      const correlativo = this.buildCorrelativo(this.defaultSerie, numero);

      return tx.cotizacion.create({
        data: {
          empresaId,
          sucursalId: dto.sucursalId ? BigInt(dto.sucursalId) : null,
          clienteId: dto.clienteId ? BigInt(dto.clienteId) : null,
          serie: this.defaultSerie,
          numero,
          correlativo,
          estado: dto.estado ?? CotizacionEstado.borrador,
          descuentoTipo: dto.descuentoTipo ?? null,
          descuentoValor: dto.descuentoValor
            ? new Prisma.Decimal(dto.descuentoValor)
            : null,
          subtotal: totals.subtotal,
          descuentoMonto: totals.descuentoGlobalMonto,
          total: totals.total,
          observaciones: dto.observaciones ?? null,
          validaHasta: dto.validaHasta ? new Date(dto.validaHasta) : null,
          creadoPorId: usuarioId,
          detalles: { create: totals.detallesData },
        },
        include: quotationInclude,
      });
    });

    return this.toQuotationResponse(quotation);
  }

  async findAll(
    empresaId: bigint,
    scope: CommercialScope,
    query: FindQuotationsQueryDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? this.getDefaultPaginationLimit();
    const search = query.search?.trim();
    const dateRange = resolveHistoryDateRange(query);

    const where: Prisma.CotizacionWhereInput = {
      empresaId,
      ...(query.estado ? { estado: query.estado } : {}),
      ...(resolveScopedBranchId(scope, query.sucursalId)
        ? { sucursalId: resolveScopedBranchId(scope, query.sucursalId)! }
        : {}),
      ...(scopedCreatorId(scope)
        ? { creadoPorId: scopedCreatorId(scope)! }
        : {}),
      ...(query.clienteId ? { clienteId: BigInt(query.clienteId) } : {}),
      createdAt: dateRange,
      ...(search
        ? {
            OR: [
              { correlativo: { contains: search, mode: 'insensitive' } },
              {
                cliente: {
                  nombre: { contains: search, mode: 'insensitive' },
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

    const [quotations, total] = await this.prisma.$transaction([
      this.prisma.cotizacion.findMany({
        where,
        include: quotationInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.cotizacion.count({ where }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      data: quotations.map((q) => this.toQuotationResponse(q)),
      meta: { page, limit, total, totalPages },
    };
  }

  async findOne(empresaId: bigint, scope: CommercialScope, publicId: string) {
    const quotation = await this.prisma.cotizacion.findFirst({
      where: this.quotationAccessWhere(empresaId, scope, publicId),
      include: quotationInclude,
    });

    if (!quotation) {
      throw new NotFoundException('Cotizacion no encontrada');
    }

    return this.toQuotationResponse(quotation);
  }

  async update(
    empresaId: bigint,
    scope: CommercialScope,
    publicId: string,
    dto: UpdateQuotationDto,
  ) {
    const quotation = await this.prisma.cotizacion.findFirst({
      where: this.quotationAccessWhere(empresaId, scope, publicId),
      include: { detalles: true },
    });

    if (!quotation) {
      throw new NotFoundException('Cotizacion no encontrada');
    }
    if (quotation.estado === CotizacionEstado.convertida) {
      throw new BadRequestException('La cotizacion ya fue convertida');
    }
    if (quotation.estado === CotizacionEstado.anulada) {
      throw new BadRequestException('La cotizacion esta anulada');
    }
    this.ensureEditableState(dto.estado);
    const effectiveBranchId =
      dto.sucursalId === undefined
        ? undefined
        : resolveScopedBranchId(scope, dto.sucursalId);
    if (dto.sucursalId !== undefined)
      dto.sucursalId = effectiveBranchId?.toString();
    await this.validateHeaderReferences(
      empresaId,
      dto.sucursalId,
      dto.clienteId,
    );

    const shouldRecalculate =
      dto.detalles !== undefined ||
      dto.descuentoTipo !== undefined ||
      dto.descuentoValor !== undefined;

    const totals = shouldRecalculate
      ? await this.buildTotals(
          empresaId,
          dto.detalles ??
            quotation.detalles.map((d) => ({
              productoVarianteId: d.productoVarianteId.toString(),
              cantidad: d.cantidad,
              precioUnitario: d.precioUnitario.toString(),
              descuentoTipo: d.descuentoTipo ?? undefined,
              descuentoValor: d.descuentoValor?.toString(),
            })),
          {
            descuentoTipo:
              dto.descuentoTipo ?? quotation.descuentoTipo ?? undefined,
            descuentoValor:
              dto.descuentoValor ?? quotation.descuentoValor?.toString(),
          },
        )
      : null;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.detalles !== undefined) {
        await tx.cotizacionDetalle.deleteMany({
          where: { cotizacionId: quotation.id },
        });
      }

      return tx.cotizacion.update({
        where: { id: quotation.id },
        data: {
          ...(dto.sucursalId !== undefined
            ? { sucursalId: dto.sucursalId ? BigInt(dto.sucursalId) : null }
            : {}),
          ...(dto.clienteId !== undefined
            ? { clienteId: dto.clienteId ? BigInt(dto.clienteId) : null }
            : {}),
          ...(dto.estado !== undefined ? { estado: dto.estado } : {}),
          ...(dto.descuentoTipo !== undefined
            ? { descuentoTipo: dto.descuentoTipo }
            : {}),
          ...(dto.descuentoValor !== undefined
            ? {
                descuentoValor: dto.descuentoValor
                  ? new Prisma.Decimal(dto.descuentoValor)
                  : null,
              }
            : {}),
          ...(totals
            ? {
                subtotal: totals.subtotal,
                descuentoMonto: totals.descuentoGlobalMonto,
                total: totals.total,
              }
            : {}),
          ...(dto.observaciones !== undefined
            ? { observaciones: dto.observaciones || null }
            : {}),
          ...(dto.validaHasta !== undefined
            ? {
                validaHasta: dto.validaHasta ? new Date(dto.validaHasta) : null,
              }
            : {}),
          ...(dto.detalles !== undefined && totals
            ? { detalles: { create: totals.detallesData } }
            : {}),
        },
        include: quotationInclude,
      });
    });

    return this.toQuotationResponse(updated);
  }

  async annul(
    empresaId: bigint,
    scope: CommercialScope,
    publicId: string,
    dto: AnnulQuotationDto,
  ) {
    const quotation = await this.prisma.cotizacion.findFirst({
      where: this.quotationAccessWhere(empresaId, scope, publicId),
    });

    if (!quotation) {
      throw new NotFoundException('Cotizacion no encontrada');
    }
    if (quotation.estado === CotizacionEstado.convertida) {
      throw new BadRequestException('La cotizacion ya fue convertida');
    }
    if (quotation.estado === CotizacionEstado.anulada) {
      throw new BadRequestException('La cotizacion ya esta anulada');
    }

    const updated = await this.prisma.cotizacion.update({
      where: { id: quotation.id },
      data: {
        estado: CotizacionEstado.anulada,
        anuladoAt: new Date(),
        anuladoRazon: dto.razon,
      },
      include: quotationInclude,
    });

    return this.toQuotationResponse(updated);
  }

  async convertToSale(
    empresaId: bigint,
    scope: CommercialScope,
    publicId: string,
    dto: ConvertQuotationToSaleDto,
  ) {
    const quotation = await this.prisma.cotizacion.findFirst({
      where: this.quotationAccessWhere(empresaId, scope, publicId),
      include: { detalles: true },
    });

    if (!quotation) {
      throw new NotFoundException('Cotizacion no encontrada');
    }
    if (quotation.estado === CotizacionEstado.convertida) {
      throw new BadRequestException('La cotizacion ya fue convertida');
    }
    if (quotation.estado === CotizacionEstado.anulada) {
      throw new BadRequestException('La cotizacion esta anulada');
    }
    if (quotation.estado === CotizacionEstado.rechazada) {
      throw new BadRequestException('La cotizacion fue rechazada');
    }
    if (quotation.validaHasta && quotation.validaHasta < new Date()) {
      await this.prisma.cotizacion.update({
        where: { id: quotation.id },
        data: { estado: CotizacionEstado.vencida },
      });
      throw new BadRequestException('La cotizacion esta vencida');
    }

    const targetClienteId =
      dto.clienteId === undefined
        ? quotation.clienteId?.toString()
        : (dto.clienteId ?? undefined);

    if (targetClienteId) {
      await this.validateHeaderReferences(
        empresaId,
        undefined,
        targetClienteId,
      );
    }

    const sale = await this.salesService.create(empresaId, scope, {
      tipoComprobante: dto.tipoComprobante,
      sucursalId: quotation.sucursalId?.toString(),
      clienteId: targetClienteId,
      descuentoTipo: quotation.descuentoTipo ?? undefined,
      descuentoValor: quotation.descuentoValor?.toString(),
      detalles: quotation.detalles.map((d) => ({
        productoVarianteId: d.productoVarianteId.toString(),
        cantidad: d.cantidad,
        precioUnitario: d.precioUnitario.toString(),
        descuentoTipo: d.descuentoTipo ?? undefined,
        descuentoValor: d.descuentoValor?.toString(),
      })),
      pagos: dto.pagos,
      observaciones: dto.observaciones ?? quotation.observaciones ?? undefined,
    });

    const venta = await this.prisma.venta.findUnique({
      where: { publicId: sale.publicId },
      select: { id: true },
    });

    if (!venta) {
      throw new NotFoundException('Venta convertida no encontrada');
    }

    const updated = await this.prisma.cotizacion.update({
      where: { id: quotation.id },
      data: {
        estado: CotizacionEstado.convertida,
        convertidaVentaId: venta.id,
        clienteId: targetClienteId ? BigInt(targetClienteId) : null,
      },
      include: quotationInclude,
    });

    return {
      quotation: this.toQuotationResponse(updated),
      sale,
    };
  }

  private quotationAccessWhere(
    empresaId: bigint,
    scope: CommercialScope,
    publicId: string,
  ): Prisma.CotizacionWhereInput {
    return {
      empresaId,
      publicId,
      ...(scope.branchId ? { sucursalId: scope.branchId } : {}),
      ...(scopedCreatorId(scope)
        ? { creadoPorId: scopedCreatorId(scope)! }
        : {}),
    };
  }

  private async validateHeaderReferences(
    empresaId: bigint,
    sucursalId?: string,
    clienteId?: string,
  ) {
    if (sucursalId) {
      const sucursal = await this.prisma.sucursal.findFirst({
        where: {
          id: BigInt(sucursalId),
          empresaId,
          estado: 'activo',
          tipo: SucursalTipo.tienda,
        },
      });
      if (!sucursal) {
        throw new NotFoundException('Sucursal no encontrada');
      }
    }

    if (clienteId) {
      const cliente = await this.prisma.cliente.findFirst({
        where: { id: BigInt(clienteId), empresaId },
      });
      if (!cliente) {
        throw new NotFoundException('Cliente no encontrado');
      }
    }
  }

  private async buildTotals(
    empresaId: bigint,
    detalles: QuotationDetalleInput[],
    discount: {
      descuentoTipo?: CreateQuotationDto['descuentoTipo'];
      descuentoValor?: string;
    },
  ) {
    if (!detalles?.length) {
      throw new BadRequestException('La cotizacion debe tener detalles');
    }

    const uniqueVariantIds = [
      ...new Set(detalles.map((d) => d.productoVarianteId)),
    ].map((id) => BigInt(id));
    const variantes = await this.prisma.productoVariante.findMany({
      where: {
        id: { in: uniqueVariantIds },
        empresaId,
        activo: true,
        deletedAt: null,
      },
    });
    const varianteMap = new Map(variantes.map((v) => [v.id.toString(), v]));

    for (const detalle of detalles) {
      if (!varianteMap.has(detalle.productoVarianteId)) {
        throw new NotFoundException('Una o mas variantes no encontradas');
      }
    }

    let subtotal = new Prisma.Decimal(0);
    const detallesData: Prisma.CotizacionDetalleCreateWithoutCotizacionInput[] =
      [];

    for (const detalle of detalles) {
      const variante = varianteMap.get(detalle.productoVarianteId)!;
      const precioUnitario = detalle.precioUnitario
        ? parseUnitPrice(detalle.precioUnitario)
        : variante.precioVenta;
      const subtotalLinea = precioUnitario.mul(detalle.cantidad);
      let descuentoMonto = new Prisma.Decimal(0);

      if (detalle.descuentoTipo && detalle.descuentoValor) {
        const descuentoValor = new Prisma.Decimal(detalle.descuentoValor);
        descuentoMonto =
          detalle.descuentoTipo === 'porcentaje'
            ? subtotalLinea.mul(descuentoValor).div(100)
            : descuentoValor;
      }

      const totalLinea = subtotalLinea.sub(descuentoMonto);

      detallesData.push({
        productoVariante: {
          connect: { id: BigInt(detalle.productoVarianteId) },
        },
        cantidad: detalle.cantidad,
        precioUnitario,
        descuentoTipo: detalle.descuentoTipo ?? null,
        descuentoValor: detalle.descuentoValor
          ? new Prisma.Decimal(detalle.descuentoValor)
          : null,
        descuentoMonto,
        subtotal: subtotalLinea,
        total: totalLinea,
      });
      subtotal = subtotal.add(subtotalLinea);
    }

    let descuentoGlobalMonto = new Prisma.Decimal(0);
    if (discount.descuentoTipo && discount.descuentoValor) {
      const descuentoValor = new Prisma.Decimal(discount.descuentoValor);
      descuentoGlobalMonto =
        discount.descuentoTipo === 'porcentaje'
          ? subtotal.mul(descuentoValor).div(100)
          : descuentoValor;
    }

    return {
      detallesData,
      subtotal,
      descuentoGlobalMonto,
      total: subtotal.sub(descuentoGlobalMonto),
    };
  }

  private ensureEditableState(estado?: CotizacionEstado) {
    if (
      estado === CotizacionEstado.convertida ||
      estado === CotizacionEstado.anulada
    ) {
      throw new BadRequestException(
        'Use los endpoints dedicados para convertir o anular cotizaciones',
      );
    }
  }

  private buildCorrelativo(serie: string, numero: number) {
    return `${serie}-${numero.toString().padStart(6, '0')}`;
  }

  private getDefaultPaginationLimit() {
    const defaultLimit = Number(
      this.configService.get<string>('PAGINATION_DEFAULT_LIMIT') ?? 12,
    );
    const maxLimit = Number(
      this.configService.get<string>('PAGINATION_MAX_LIMIT') ?? 100,
    );

    if (!Number.isInteger(defaultLimit) || defaultLimit <= 0) {
      return 12;
    }
    if (!Number.isInteger(maxLimit) || maxLimit <= 0) {
      return defaultLimit;
    }

    return Math.min(defaultLimit, maxLimit);
  }

  private toQuotationResponse(quotation: QuotationWithRelations) {
    return {
      publicId: quotation.publicId,
      serie: quotation.serie,
      numero: quotation.numero,
      correlativo: quotation.correlativo,
      estado: quotation.estado,
      subtotal: quotation.subtotal.toString(),
      descuentoTipo: quotation.descuentoTipo,
      descuentoValor: quotation.descuentoValor?.toString() ?? null,
      descuentoMonto: quotation.descuentoMonto.toString(),
      total: quotation.total.toString(),
      observaciones: quotation.observaciones,
      validaHasta: quotation.validaHasta?.toISOString() ?? null,
      anuladoAt: quotation.anuladoAt?.toISOString() ?? null,
      anuladoRazon: quotation.anuladoRazon,
      createdAt: quotation.createdAt.toISOString(),
      convertidaVenta: quotation.convertidaVenta
        ? {
            publicId: quotation.convertidaVenta.publicId,
            correlativo: quotation.convertidaVenta.correlativo,
          }
        : null,
      convertidaVentaId: quotation.convertidaVentaId?.toString() ?? null,
      sucursal: quotation.sucursal
        ? {
            id: quotation.sucursal.id.toString(),
            nombre: quotation.sucursal.nombre,
          }
        : null,
      cliente: quotation.cliente
        ? {
            id: quotation.cliente.id.toString(),
            empresaId: quotation.cliente.empresaId.toString(),
            nombre: quotation.cliente.nombre,
            razonSocial: quotation.cliente.razonSocial,
            displayName:
              quotation.cliente.razonSocial ||
              quotation.cliente.nombre ||
              'Cliente sin nombre',
            tipoDocumento: quotation.cliente.tipoDocumento,
            numeroDocumento: quotation.cliente.numeroDocumento,
            telefono: quotation.cliente.telefono,
            email: quotation.cliente.email,
            direccion: quotation.cliente.direccion,
            ubigeo: quotation.cliente.ubigeo,
            distrito: quotation.cliente.distrito,
            estado: quotation.cliente.estado,
            createdAt: quotation.cliente.createdAt.toISOString(),
            updatedAt: quotation.cliente.updatedAt.toISOString(),
          }
        : null,
      creadoPor: quotation.creadoPor
        ? {
            id: quotation.creadoPor.id.toString(),
            nombre: quotation.creadoPor.nombre,
            apellido: quotation.creadoPor.apellido,
          }
        : null,
      detalles: quotation.detalles.map((d) => {
        const pv = d.productoVariante;
        const image = pv.productoColor.imagenes[0];
        return {
          id: d.id.toString(),
          cantidad: d.cantidad,
          precioUnitario: d.precioUnitario.toString(),
          descuentoTipo: d.descuentoTipo,
          descuentoValor: d.descuentoValor?.toString() ?? null,
          descuentoMonto: d.descuentoMonto.toString(),
          subtotal: d.subtotal.toString(),
          total: d.total.toString(),
          productoVariante: {
            id: pv.id.toString(),
            sku: pv.sku,
            codigoBarras: pv.codigoBarras,
            producto: {
              id: pv.producto.id.toString(),
              publicId: pv.producto.publicId,
              nombre: pv.producto.nombre,
              tipo: pv.producto.tipo,
            },
            color: {
              id: pv.productoColor.color.id.toString(),
              nombre: pv.productoColor.color.nombre,
              hex: pv.productoColor.color.hex,
            },
            talla: {
              id: pv.talla.id.toString(),
              nombre: pv.talla.nombre,
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
    };
  }
}
