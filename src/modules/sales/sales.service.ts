import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CajaMovimientoTipo,
  CajaSesionEstado,
  ClienteTipoDocumento,
  Prisma,
  SerieComprobante,
  SunatEstado,
  StockMovimientoTipo,
  SucursalTipo,
  VentaEstado,
  VentaTipoComprobante,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  resolveScopedBranchId,
  scopedCreatorId,
  type CommercialScope,
} from '../../common/commercial-access';
import { parseUnitPrice } from '../../common/unit-price';
import { PlansService } from '../plans/plans.service';
import { StockService } from '../stock/stock.service';
import { CreateSaleDto } from './dto/create-sale.dto';
import {
  FindComprobantesQueryDto,
  FindSalesQueryDto,
} from './dto/find-sales-query.dto';
import { FindSaleProductsQueryDto } from './dto/find-sale-products-query.dto';
import { AnnulSaleDto } from './dto/annul-sale.dto';
import { FindSeriesQueryDto } from './dto/find-series-query.dto';
import { resolveHistoryDateRange } from '../../common/history-date-range';
import {
  CreateSerieComprobanteDto,
  UpdateSerieComprobanteDto,
} from './dto/serie-comprobante.dto';
import {
  SunatTaxService,
  TaxInputLine,
} from '../sunat-emission/sunat-tax.service';
import { isElectronicSaleType } from '../sunat-emission/sunat-comprobante.helper';
import { SunatBajaService } from '../sunat-emission/sunat-baja.service';
import { assertSunatEnvironmentAllowed } from '../plans/sunat-plan-access';

const ventaInclude = {
  sucursal: { select: { id: true, nombre: true } },
  cliente: {
    select: {
      id: true,
      nombre: true,
      tipoDocumento: true,
      numeroDocumento: true,
    },
  },
  serieComprobante: {
    select: { id: true, serie: true, tipoComprobante: true },
  },
  cajaSesion: {
    select: { publicId: true, estado: true, openedAt: true, closedAt: true },
  },
  sunatBajaLote: {
    select: {
      tipoEnvio: true,
      fechaGeneracion: true,
      correlativo: true,
      sunatXmlKey: true,
      sunatCdrKey: true,
    },
  },
  creadoPor: { select: { id: true, nombre: true, apellido: true } },
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
  pagos: {
    include: {
      metodoPago: {
        select: {
          id: true,
          nombre: true,
          nombreKey: true,
          codigo: true,
          esSistema: true,
          permiteVuelto: true,
        },
      },
    },
  },
} satisfies Prisma.VentaInclude;

type VentaWithRelations = Prisma.VentaGetPayload<{
  include: typeof ventaInclude;
}>;

const saleProductGroupInclude = {
  marca: true,
  categoria: true,
  unidadMedida: true,
  tipoAfectacionIgv: true,
  variantes: {
    where: {
      activo: true,
      deletedAt: null,
      productoColor: { activo: true },
    },
    include: {
      productoColor: {
        include: {
          color: true,
          imagenes: {
            orderBy: [{ esPrincipal: 'desc' }, { orden: 'asc' }, { id: 'asc' }],
            take: 1,
          },
        },
      },
      talla: true,
      inventarios: {
        include: { sucursal: true },
        orderBy: { id: 'asc' },
      },
    },
    orderBy: [
      { productoColor: { color: { nombre: 'asc' } } },
      { talla: { nombre: 'asc' } },
    ],
  },
} satisfies Prisma.ProductoInclude;

type SaleProductGroup = Prisma.ProductoGetPayload<{
  include: typeof saleProductGroupInclude;
}>;

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly sunatTaxService: SunatTaxService,
    private readonly sunatBajaService: SunatBajaService,
    private readonly plansService: PlansService,
    private readonly stockService: StockService,
  ) {}

  // ── Series ─────────────────────────────────────────────────────────

  async findSeries(
    empresaId: bigint,
    scope: CommercialScope,
    query: FindSeriesQueryDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? this.getDefaultPaginationLimit();
    const search = query.search?.trim();
    const sucursalId = resolveScopedBranchId(scope, query.sucursalId);

    const where: Prisma.SerieComprobanteWhereInput = {
      empresaId,
      ...(query.tipoComprobante
        ? { tipoComprobante: query.tipoComprobante }
        : {}),
      ...(query.activo !== undefined ? { activo: query.activo } : {}),
      ...(sucursalId
        ? {
            OR: [
              { aplicaTodasSucursales: true },
              { sucursales: { some: { sucursalId } } },
            ],
          }
        : {}),
      ...(search ? { serie: { contains: search, mode: 'insensitive' } } : {}),
    };

    const [series, total] = await this.prisma.$transaction([
      this.prisma.serieComprobante.findMany({
        where,
        include: {
          sucursales: {
            include: {
              sucursal: { select: { id: true, nombre: true } },
            },
            orderBy: { sucursalId: 'asc' },
          },
        },
        orderBy: [
          { tipoComprobante: 'asc' },
          { esPrincipal: 'desc' },
          { serie: 'asc' },
        ],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.serieComprobante.count({ where }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      data: series.map((s) => ({
        id: s.id.toString(),
        tipoComprobante: s.tipoComprobante,
        serie: s.serie,
        numeroActual: s.numeroActual,
        esPrincipal: s.esPrincipal,
        aplicaTodasSucursales: s.aplicaTodasSucursales,
        sucursales: s.sucursales.map((assignment) => ({
          id: assignment.sucursal.id.toString(),
          nombre: assignment.sucursal.nombre,
        })),
        activo: s.activo,
        createdAt: s.createdAt.toISOString(),
      })),
      meta: { page, limit, total, totalPages },
    };
  }

  async createSerie(empresaId: bigint, dto: CreateSerieComprobanteDto) {
    const serieCode = dto.serie.trim().toUpperCase();
    this.validateElectronicSerie(dto.tipoComprobante, serieCode);
    const aplicaTodasSucursales = dto.aplicaTodasSucursales ?? true;
    const sucursalIds = await this.resolveSerieSucursalIds(
      empresaId,
      aplicaTodasSucursales,
      dto.sucursalIds ?? [],
    );

    await this.ensureSerieScopeAvailable({
      empresaId,
      tipoComprobante: dto.tipoComprobante,
      aplicaTodasSucursales,
      sucursalIds,
      activo: true,
    });

    const serie = await this.prisma.$transaction(async (tx) => {
      if (dto.esPrincipal) {
        await tx.serieComprobante.updateMany({
          where: {
            empresaId,
            tipoComprobante: dto.tipoComprobante,
            esPrincipal: true,
          },
          data: { esPrincipal: false },
        });
      }

      return tx.serieComprobante.create({
        data: {
          empresaId,
          tipoComprobante: dto.tipoComprobante,
          serie: serieCode,
          esPrincipal: dto.esPrincipal ?? false,
          aplicaTodasSucursales,
          sucursales: aplicaTodasSucursales
            ? undefined
            : {
                create: sucursalIds.map((sucursalId) => ({
                  empresaId,
                  sucursalId,
                })),
              },
        },
        include: {
          sucursales: {
            include: {
              sucursal: { select: { id: true, nombre: true } },
            },
            orderBy: { sucursalId: 'asc' },
          },
        },
      });
    });

    return this.toSerieResponse(serie);
  }

  async updateSerie(
    empresaId: bigint,
    serieId: string,
    dto: UpdateSerieComprobanteDto,
  ) {
    const serie = await this.prisma.serieComprobante.findFirst({
      where: { id: BigInt(serieId), empresaId },
      include: { sucursales: true },
    });
    if (!serie) {
      throw new NotFoundException('Serie no encontrada');
    }

    const aplicaTodasSucursales =
      dto.aplicaTodasSucursales ?? serie.aplicaTodasSucursales;
    const sucursalIds = await this.resolveSerieSucursalIds(
      empresaId,
      aplicaTodasSucursales,
      dto.sucursalIds ?? serie.sucursales.map((s) => s.sucursalId.toString()),
    );
    const activo = dto.activo ?? serie.activo;

    await this.ensureSerieScopeAvailable({
      empresaId,
      tipoComprobante: serie.tipoComprobante,
      aplicaTodasSucursales,
      sucursalIds,
      activo,
      excludeSerieId: serie.id,
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.esPrincipal === true) {
        await tx.serieComprobante.updateMany({
          where: {
            empresaId,
            tipoComprobante: serie.tipoComprobante,
            esPrincipal: true,
          },
          data: { esPrincipal: false },
        });
      }

      await tx.serieComprobanteSucursal.deleteMany({
        where: { serieComprobanteId: serie.id },
      });

      return tx.serieComprobante.update({
        where: { id: serie.id },
        data: {
          ...(dto.esPrincipal !== undefined
            ? { esPrincipal: dto.esPrincipal }
            : {}),
          ...(dto.activo !== undefined ? { activo: dto.activo } : {}),
          aplicaTodasSucursales,
          sucursales: aplicaTodasSucursales
            ? undefined
            : {
                create: sucursalIds.map((sucursalId) => ({
                  empresaId,
                  sucursalId,
                })),
              },
        },
        include: {
          sucursales: {
            include: {
              sucursal: { select: { id: true, nombre: true } },
            },
            orderBy: { sucursalId: 'asc' },
          },
        },
      });
    });

    return this.toSerieResponse(updated);
  }

  // ── Create Sale ────────────────────────────────────────────────────

  async create(empresaId: bigint, scope: CommercialScope, dto: CreateSaleDto) {
    const effectiveBranchId = resolveScopedBranchId(scope, dto.sucursalId);
    if (scope.branchId && !effectiveBranchId) {
      throw new BadRequestException('Debes usar tu sucursal asignada');
    }
    dto.sucursalId = effectiveBranchId?.toString();
    const userId = scope.userId.toString();
    const usuarioId = BigInt(userId);
    const electronicSale = isElectronicSaleType(dto.tipoComprobante);

    const sucursal = dto.sucursalId
      ? await this.prisma.sucursal.findFirst({
          where: {
            id: BigInt(dto.sucursalId),
            empresaId,
            estado: 'activo',
            tipo: SucursalTipo.tienda,
          },
          select: { id: true, modoCajaHabilitado: true },
        })
      : null;

    if (dto.sucursalId) {
      if (!sucursal) {
        throw new NotFoundException('Sucursal no encontrada');
      }
    }

    if (sucursal?.modoCajaHabilitado) {
      const openCashRegister = await this.prisma.cajaSesion.findFirst({
        where: {
          empresaId,
          sucursalId: sucursal.id,
          usuarioId,
          estado: CajaSesionEstado.abierta,
        },
        select: { id: true },
      });

      if (!openCashRegister) {
        throw new BadRequestException(
          'Debes abrir caja en esta sucursal antes de vender',
        );
      }
    }

    const cliente = dto.clienteId
      ? await this.prisma.cliente.findFirst({
          where: { id: BigInt(dto.clienteId), empresaId },
        })
      : null;

    if (dto.clienteId && !cliente) {
      throw new NotFoundException('Cliente no encontrado');
    }

    if (electronicSale) {
      await this.validateSunatSalePrerequisites(
        empresaId,
        dto.tipoComprobante,
        cliente,
      );
    }

    const varianteIds = dto.detalles.map((d) => BigInt(d.productoVarianteId));
    const variantes = await this.prisma.productoVariante.findMany({
      where: {
        id: { in: varianteIds },
        empresaId,
        activo: true,
        deletedAt: null,
      },
      include: {
        producto: {
          include: {
            unidadMedida: true,
            tipoAfectacionIgv: true,
          },
        },
      },
    });

    if (variantes.length !== varianteIds.length) {
      throw new NotFoundException('Una o mas variantes no encontradas');
    }

    const varianteMap = new Map(variantes.map((v) => [v.id.toString(), v]));

    const metodoPagoIds = dto.pagos.map((p) => BigInt(p.metodoPagoId));
    const metodosPago = await this.prisma.metodoPago.findMany({
      where: {
        id: { in: metodoPagoIds },
        empresaId,
        estado: 'activo',
        deletedAt: null,
      },
    });

    if (metodosPago.length !== metodoPagoIds.length) {
      throw new NotFoundException('Uno o mas metodos de pago no encontrados');
    }
    const metodoPagoMap = new Map(
      metodosPago.map((method) => [method.id.toString(), method]),
    );

    const serie = await this.resolveSerie(
      empresaId,
      dto.tipoComprobante,
      dto.sucursalId ? BigInt(dto.sucursalId) : null,
    );

    if (electronicSale) {
      this.validateElectronicSerie(dto.tipoComprobante, serie.serie);
    }

    const sunatConfig = electronicSale
      ? await this.prisma.sunatConfig.findUnique({
          where: { empresaId },
          select: { igvPorcentaje: true },
        })
      : null;
    const igvPorcentaje = sunatConfig?.igvPorcentaje ?? new Prisma.Decimal(18);
    const taxLines: TaxInputLine[] = [];

    for (const detalle of dto.detalles) {
      const variante = varianteMap.get(detalle.productoVarianteId)!;
      const precioUnitario = detalle.precioUnitario
        ? parseUnitPrice(detalle.precioUnitario)
        : variante.precioVenta;

      taxLines.push({
        productoVarianteId: BigInt(detalle.productoVarianteId),
        cantidad: detalle.cantidad,
        precioUnitario,
        descuentoTipo: detalle.descuentoTipo ?? null,
        descuentoValor: detalle.descuentoValor
          ? new Prisma.Decimal(detalle.descuentoValor)
          : null,
        descripcion: variante.producto.nombre,
        unidadMedidaCodigo: variante.producto.unidadMedida.codigo,
        tipoAfectacionIgvCodigo: variante.producto.tipoAfectacionIgv.codigo,
      });
    }

    const calculated = this.sunatTaxService.calculate({
      tipoComprobante: dto.tipoComprobante,
      lines: taxLines,
      descuentoTipo: dto.descuentoTipo,
      descuentoValor: dto.descuentoValor
        ? new Prisma.Decimal(dto.descuentoValor)
        : null,
      igvPorcentaje,
    });

    const subtotal = calculated.subtotal;
    const descuentoGlobalMonto = calculated.descuentoMonto;
    const total = calculated.total;
    const detallesData: Prisma.VentaDetalleUncheckedCreateWithoutVentaInput[] =
      calculated.lines.map((line) => ({
        productoVarianteId: line.productoVarianteId,
        descripcion: line.descripcion,
        cantidad: line.cantidad,
        unidadMedidaCodigo: line.unidadMedidaCodigo,
        tipoAfectacionIgvCodigo: line.tipoAfectacionIgvCodigo,
        precioUnitario: line.precioUnitario,
        valorUnitario: line.valorUnitario,
        descuentoTipo: line.descuentoTipo,
        descuentoValor: line.descuentoValor,
        descuentoMonto: line.descuentoMonto,
        valorVenta: line.valorVenta,
        igvMonto: line.igvMonto,
        subtotal: line.subtotal,
        total: line.total,
      }));

    const pagoTotal = dto.pagos.reduce(
      (sum, p) => sum.add(this.parseDecimalAmount(p.monto, 'monto')),
      new Prisma.Decimal(0),
    );

    if (!pagoTotal.equals(total)) {
      throw new BadRequestException(
        `El total de pagos (${pagoTotal.toFixed(2)}) no coincide con el total de la venta (${total.toFixed(2)})`,
      );
    }

    const pagosData = dto.pagos.map((p) => {
      const metodoPago = metodoPagoMap.get(p.metodoPagoId)!;
      const monto = this.parseDecimalAmount(p.monto, 'monto');
      const montoRecibido = p.montoRecibido
        ? this.parseDecimalAmount(p.montoRecibido, 'montoRecibido')
        : monto;

      if (montoRecibido.lt(monto)) {
        throw new BadRequestException(
          'El monto recibido no puede ser menor al monto aplicado',
        );
      }

      if (!metodoPago.permiteVuelto && !montoRecibido.equals(monto)) {
        throw new BadRequestException(
          `${metodoPago.nombre} no permite vuelto; el monto recibido debe coincidir con el monto aplicado`,
        );
      }

      const vuelto = metodoPago.permiteVuelto
        ? montoRecibido.sub(monto)
        : new Prisma.Decimal(0);

      return {
        metodoPagoId: metodoPago.id,
        monto,
        montoRecibido: p.montoRecibido ? montoRecibido : null,
        vuelto,
        referencia: p.referencia ?? null,
      };
    });

    const venta = await this.prisma.$transaction(
      async (tx) => {
        const documentAllowance =
          await this.plansService.assessDocumentAllowance(tx, empresaId);
        const cajaSesion = sucursal?.modoCajaHabilitado
          ? await tx.cajaSesion.findFirst({
              where: {
                empresaId,
                sucursalId: sucursal.id,
                usuarioId,
                estado: CajaSesionEstado.abierta,
              },
              select: { id: true },
            })
          : null;

        if (sucursal?.modoCajaHabilitado && !cajaSesion) {
          throw new BadRequestException(
            'Debes abrir caja en esta sucursal antes de vender',
          );
        }

        const updatedSerie = await tx.serieComprobante.update({
          where: { id: serie.id },
          data: { numeroActual: { increment: 1 } },
        });

        const numero = updatedSerie.numeroActual;
        const correlativo = `${serie.serie}-${numero.toString().padStart(6, '0')}`;

        const ventaData = await tx.venta.create({
          data: {
            empresaId,
            sucursalId: dto.sucursalId ? BigInt(dto.sucursalId) : null,
            clienteId: dto.clienteId ? BigInt(dto.clienteId) : null,
            tipoComprobante: dto.tipoComprobante,
            serieComprobanteId: serie.id,
            serie: serie.serie,
            numero,
            correlativo,
            moneda: 'PEN',
            formaPago: 'CONTADO',
            descuentoTipo: dto.descuentoTipo ?? null,
            descuentoValor: dto.descuentoValor
              ? new Prisma.Decimal(dto.descuentoValor)
              : null,
            subtotal,
            descuentoMonto: descuentoGlobalMonto,
            igvPorcentaje: calculated.igvPorcentaje,
            opGravadas: calculated.opGravadas,
            opExoneradas: calculated.opExoneradas,
            opInafectas: calculated.opInafectas,
            igvMonto: calculated.igvMonto,
            total,
            estado: VentaEstado.completada,
            sunatEstado: electronicSale
              ? SunatEstado.pendiente_envio
              : SunatEstado.no_aplica,
            observaciones: dto.observaciones ?? null,
            creadoPorId: usuarioId,
            cajaSesionId: cajaSesion?.id ?? null,
            esExcedentePlan: documentAllowance.isOverage,
            precioExcedentePlan: documentAllowance.unitPrice,
            detalles: {
              create: detallesData.map((d) => ({
                productoVarianteId: d.productoVarianteId,
                descripcion: d.descripcion,
                cantidad: d.cantidad,
                unidadMedidaCodigo: d.unidadMedidaCodigo,
                tipoAfectacionIgvCodigo: d.tipoAfectacionIgvCodigo,
                precioUnitario: d.precioUnitario,
                valorUnitario: d.valorUnitario,
                descuentoTipo: d.descuentoTipo,
                descuentoValor: d.descuentoValor,
                descuentoMonto: d.descuentoMonto,
                valorVenta: d.valorVenta,
                igvMonto: d.igvMonto,
                subtotal: d.subtotal,
                total: d.total,
              })),
            },
            pagos: {
              create: pagosData.map((p) => ({
                metodoPagoId: p.metodoPagoId,
                monto: p.monto,
                montoRecibido: p.montoRecibido,
                vuelto: p.vuelto,
                referencia: p.referencia,
              })),
            },
          },
          include: ventaInclude,
        });

        if (electronicSale) {
          await tx.sunatJob.upsert({
            where: {
              tipoDocumento_documentoId: {
                tipoDocumento: 'venta',
                documentoId: ventaData.id,
              },
            },
            create: {
              empresaId,
              tipoDocumento: 'venta',
              documentoId: ventaData.id,
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
        }

        if (cajaSesion) {
          await tx.cajaMovimiento.createMany({
            data: ventaData.pagos.map((p) => ({
              empresaId,
              cajaSesionId: cajaSesion.id,
              ventaId: ventaData.id,
              ventaPagoId: p.id,
              metodoPagoId: p.metodoPagoId,
              tipo: CajaMovimientoTipo.venta,
              monto: p.monto,
              motivo: `Venta ${ventaData.correlativo}`,
              referencia: p.referencia,
              creadoPorId: usuarioId,
            })),
          });
        }

        if (dto.sucursalId) {
          const sucursalIdBigint = BigInt(dto.sucursalId);
          for (const detalle of detallesData) {
            await this.stockService.changeStock(tx, {
              empresaId,
              sucursalId: sucursalIdBigint,
              productoVarianteId: BigInt(detalle.productoVarianteId),
              delta: -detalle.cantidad,
              tipo: StockMovimientoTipo.venta,
              motivo: `Venta ${ventaData.correlativo}`,
              creadoPorId: usuarioId,
              referenciaTipo: 'venta',
              referenciaId: ventaData.id,
            });
          }
        }

        return ventaData;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return this.toVentaResponse(venta);
  }

  // ── Find All Sales ─────────────────────────────────────────────────

  async findAll(
    empresaId: bigint,
    scope: CommercialScope,
    query: FindSalesQueryDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? this.getDefaultPaginationLimit();
    const search = query.search?.trim();

    const where: Prisma.VentaWhereInput = {
      empresaId,
      createdAt: resolveHistoryDateRange(query),
      ...(query.tipoComprobante
        ? { tipoComprobante: query.tipoComprobante }
        : {}),
      ...(query.estado ? { estado: query.estado } : {}),
      ...(resolveScopedBranchId(scope, query.sucursalId)
        ? { sucursalId: resolveScopedBranchId(scope, query.sucursalId)! }
        : {}),
      ...(scopedCreatorId(scope)
        ? { creadoPorId: scopedCreatorId(scope)! }
        : {}),
      ...(query.clienteId ? { clienteId: BigInt(query.clienteId) } : {}),
      ...(search
        ? {
            OR: [
              {
                correlativo: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                cliente: {
                  nombre: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [ventas, total] = await this.prisma.$transaction([
      this.prisma.venta.findMany({
        where,
        include: ventaInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.venta.count({ where }),
    ]);

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      data: ventas.map((v) => this.toVentaResponse(v)),
      meta: { page, limit, total, totalPages },
    };
  }

  async findComprobantes(
    empresaId: bigint,
    scope: CommercialScope,
    query: FindComprobantesQueryDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? this.getDefaultPaginationLimit();
    const search = query.search?.trim();

    const where: Prisma.VentaWhereInput = {
      empresaId,
      createdAt: resolveHistoryDateRange(query),
      ...(scope.branchId ? { sucursalId: scope.branchId } : {}),
      ...(scopedCreatorId(scope)
        ? { creadoPorId: scopedCreatorId(scope)! }
        : {}),
      tipoComprobante: query.tipoComprobante
        ? query.tipoComprobante
        : { in: [VentaTipoComprobante.factura, VentaTipoComprobante.boleta] },
      ...(query.sunatEstado ? { sunatEstado: query.sunatEstado } : {}),
      ...(search
        ? {
            OR: [
              {
                correlativo: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                sunatCodigo: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                cliente: {
                  nombre: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
              },
              {
                cliente: {
                  numeroDocumento: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [comprobantes, total, groupedSummary, acceptedTotals] =
      await this.prisma.$transaction([
        this.prisma.venta.findMany({
          where,
          include: ventaInclude,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.prisma.venta.count({ where }),
        this.prisma.venta.groupBy({
          by: ['sunatEstado'],
          where,
          orderBy: { sunatEstado: 'asc' },
          _count: true,
        }),
        this.prisma.venta.aggregate({
          where: {
            ...where,
            sunatEstado: SunatEstado.aceptado,
          },
          _sum: { total: true },
        }),
      ]);

    const summaryByStatus = new Map<SunatEstado, number>(
      groupedSummary.map((item) => [
        item.sunatEstado,
        typeof item._count === 'number'
          ? item._count
          : typeof item._count === 'object' && item._count
            ? (item._count._all ?? 0)
            : 0,
      ]),
    );
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      data: comprobantes.map((v) => this.toVentaResponse(v)),
      meta: { page, limit, total, totalPages },
      summary: {
        aceptados: summaryByStatus.get(SunatEstado.aceptado) ?? 0,
        porEnviar:
          (summaryByStatus.get(SunatEstado.pendiente_envio) ?? 0) +
          (summaryByStatus.get(SunatEstado.enviando) ?? 0),
        observados: summaryByStatus.get(SunatEstado.observado) ?? 0,
        rechazados: summaryByStatus.get(SunatEstado.rechazado) ?? 0,
        errores:
          (summaryByStatus.get(SunatEstado.error_transitorio) ?? 0) +
          (summaryByStatus.get(SunatEstado.error_definitivo) ?? 0),
        montoAceptado: acceptedTotals._sum.total?.toString() ?? '0',
      },
    };
  }

  // ── Find One Sale ──────────────────────────────────────────────────

  async findOne(empresaId: bigint, scope: CommercialScope, publicId: string) {
    const venta = await this.prisma.venta.findFirst({
      where: this.saleAccessWhere(empresaId, scope, publicId),
      include: ventaInclude,
    });

    if (!venta) {
      throw new NotFoundException('Venta no encontrada');
    }

    return this.toVentaResponse(venta);
  }

  // ── Annul Sale ─────────────────────────────────────────────────────

  async annul(
    empresaId: bigint,
    scope: CommercialScope,
    publicId: string,
    dto: AnnulSaleDto,
  ) {
    const venta = await this.prisma.venta.findFirst({
      where: this.saleAccessWhere(empresaId, scope, publicId),
      include: {
        pagos: true,
        cajaSesion: { select: { id: true, estado: true } },
      },
    });

    if (!venta) {
      throw new NotFoundException('Venta no encontrada');
    }

    if (venta.estado === VentaEstado.anulada) {
      throw new BadRequestException('La venta ya esta anulada');
    }

    if (isElectronicSaleType(venta.tipoComprobante)) {
      return this.sunatBajaService.solicitarBajaVenta(
        empresaId,
        publicId,
        dto.razon,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      if (venta.cajaSesionId) {
        const cajaSesion = await tx.cajaSesion.findUnique({
          where: { id: venta.cajaSesionId },
          select: { id: true, estado: true },
        });

        if (!cajaSesion || cajaSesion.estado !== CajaSesionEstado.abierta) {
          throw new BadRequestException(
            'No se puede anular una venta asociada a una caja cerrada',
          );
        }

        const activePayments = venta.pagos.filter((p) => p.estado === 'activo');
        await tx.cajaMovimiento.createMany({
          data: activePayments.map((p) => ({
            empresaId,
            cajaSesionId: cajaSesion.id,
            ventaId: venta.id,
            ventaPagoId: p.id,
            metodoPagoId: p.metodoPagoId,
            tipo: CajaMovimientoTipo.anulacion_venta,
            monto: p.monto.mul(-1),
            motivo: dto.razon,
            referencia: p.referencia,
          })),
        });
      }

      const anulled = await tx.venta.update({
        where: { id: venta.id },
        data: {
          estado: VentaEstado.anulada,
          anuladoAt: new Date(),
          anuladoRazon: dto.razon,
        },
        include: ventaInclude,
      });

      if (venta.sucursalId) {
        const detalles = await tx.ventaDetalle.findMany({
          where: { ventaId: venta.id },
        });

        for (const detalle of detalles) {
          await this.stockService.changeStock(tx, {
            empresaId,
            sucursalId: venta.sucursalId,
            productoVarianteId: detalle.productoVarianteId,
            delta: detalle.cantidad,
            tipo: StockMovimientoTipo.anulacion_venta,
            motivo: dto.razon,
            creadoPorId: scope.userId,
            referenciaTipo: 'venta',
            referenciaId: venta.id,
          });
        }
      }

      await tx.ventaPago.updateMany({
        where: { ventaId: venta.id },
        data: { estado: 'anulado' },
      });

      return anulled;
    });

    return this.toVentaResponse(result);
  }

  // ── Find Products (existing) ───────────────────────────────────────

  async findProducts(
    empresaId: bigint,
    scope: CommercialScope,
    query: FindSaleProductsQueryDto,
  ) {
    const scopedBranchId = resolveScopedBranchId(scope, query.sucursalId);
    query.sucursalId = scopedBranchId?.toString();
    const page = query.page ?? 1;
    const limit = query.limit ?? this.getDefaultPaginationLimit();
    const search = query.search?.trim();
    const sucursalId = this.parseOptionalId(query.sucursalId, 'sucursalId');
    const categoriaId = this.parseOptionalId(query.categoriaId, 'categoriaId');
    const marcaId = this.parseOptionalId(query.marcaId, 'marcaId');
    const colorId = this.parseOptionalId(query.colorId, 'colorId');
    const tallaId = this.parseOptionalId(query.tallaId, 'tallaId');
    const variantWhere: Prisma.ProductoVarianteWhereInput = {
      activo: true,
      deletedAt: null,
      inventarios: {
        some: {
          stockActual: { gt: 0 },
          ...(sucursalId ? { sucursalId } : {}),
        },
      },
      ...(colorId
        ? {
            productoColor: {
              colorId,
              activo: true,
            },
          }
        : {
            productoColor: {
              activo: true,
            },
          }),
      ...(tallaId ? { tallaId } : {}),
    };
    const where: Prisma.ProductoWhereInput = {
      empresaId,
      activo: true,
      deletedAt: null,
      ...(categoriaId ? { categoriaId } : {}),
      ...(marcaId ? { marcaId } : {}),
      variantes: { some: variantWhere },
      ...(search
        ? {
            OR: [
              { nombre: { contains: search, mode: 'insensitive' } },
              { nombreKey: { contains: this.buildNameKey(search) } },
              { descripcion: { contains: search, mode: 'insensitive' } },
              { marca: { nombre: { contains: search, mode: 'insensitive' } } },
              {
                categoria: {
                  nombre: { contains: search, mode: 'insensitive' },
                },
              },
              {
                variantes: {
                  some: {
                    ...variantWhere,
                    OR: [
                      { sku: { contains: search, mode: 'insensitive' } },
                      {
                        codigoBarras: {
                          contains: search,
                          mode: 'insensitive',
                        },
                      },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [products, total] = await this.prisma.$transaction([
      this.prisma.producto.findMany({
        where,
        include: saleProductGroupInclude,
        orderBy: [{ nombre: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.producto.count({ where }),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      data: products.map((product) =>
        this.toSaleProductGroupResponse(product, sucursalId, colorId, tallaId),
      ),
      meta: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }

  private saleAccessWhere(
    empresaId: bigint,
    scope: CommercialScope,
    publicId: string,
  ): Prisma.VentaWhereInput {
    return {
      empresaId,
      publicId,
      ...(scope.branchId ? { sucursalId: scope.branchId } : {}),
      ...(scopedCreatorId(scope)
        ? { creadoPorId: scopedCreatorId(scope)! }
        : {}),
    };
  }

  // ── Private Helpers ────────────────────────────────────────────────

  private async resolveSerie(
    empresaId: bigint,
    tipoComprobante: VentaTipoComprobante,
    sucursalId: bigint | null,
  ): Promise<SerieComprobante> {
    let serie: SerieComprobante | null = null;

    if (sucursalId) {
      serie = await this.prisma.serieComprobante.findFirst({
        where: {
          empresaId,
          tipoComprobante,
          activo: true,
          aplicaTodasSucursales: false,
          sucursales: { some: { sucursalId } },
        },
        orderBy: [{ esPrincipal: 'desc' }, { serie: 'asc' }],
      });
    }

    if (!serie) {
      serie = await this.prisma.serieComprobante.findFirst({
        where: {
          empresaId,
          tipoComprobante,
          esPrincipal: true,
          activo: true,
          aplicaTodasSucursales: true,
        },
        orderBy: [{ serie: 'asc' }],
      });
    }

    if (!serie) {
      serie = await this.prisma.serieComprobante.findFirst({
        where: {
          empresaId,
          tipoComprobante,
          activo: true,
          aplicaTodasSucursales: true,
        },
        orderBy: [{ serie: 'asc' }],
      });
    }

    if (!serie) {
      throw new NotFoundException(
        `No se encontro serie activa para ${tipoComprobante}`,
      );
    }

    return serie;
  }

  private async resolveSerieSucursalIds(
    empresaId: bigint,
    aplicaTodasSucursales: boolean,
    sucursalIds: string[],
  ) {
    if (aplicaTodasSucursales) {
      return [];
    }

    const normalizedIds = [...new Set(sucursalIds.map((id) => id.trim()))];

    if (normalizedIds.length === 0) {
      throw new BadRequestException('Debes seleccionar al menos una sucursal');
    }

    for (const id of normalizedIds) {
      if (!/^\d+$/.test(id)) {
        throw new BadRequestException('sucursalIds contiene un id invalido');
      }
    }

    const ids = normalizedIds.map((id) => BigInt(id));
    const count = await this.prisma.sucursal.count({
      where: { id: { in: ids }, empresaId, tipo: SucursalTipo.tienda },
    });

    if (count !== ids.length) {
      throw new NotFoundException(
        'Una o mas sucursales no fueron encontradas o no son tipo tienda',
      );
    }

    return ids;
  }

  private async ensureSerieScopeAvailable(params: {
    empresaId: bigint;
    tipoComprobante: VentaTipoComprobante;
    aplicaTodasSucursales: boolean;
    sucursalIds: bigint[];
    activo: boolean;
    excludeSerieId?: bigint;
  }) {
    if (!params.activo) {
      return;
    }

    const idFilter = params.excludeSerieId
      ? { not: params.excludeSerieId }
      : undefined;

    if (params.aplicaTodasSucursales) {
      const activeSerie = await this.prisma.serieComprobante.findFirst({
        where: {
          id: idFilter,
          empresaId: params.empresaId,
          tipoComprobante: params.tipoComprobante,
          activo: true,
        },
      });

      if (activeSerie) {
        throw new ConflictException(
          'Ya existe una serie activa para este tipo de comprobante',
        );
      }

      return;
    }

    const globalSerie = await this.prisma.serieComprobante.findFirst({
      where: {
        id: idFilter,
        empresaId: params.empresaId,
        tipoComprobante: params.tipoComprobante,
        activo: true,
        aplicaTodasSucursales: true,
      },
    });

    if (globalSerie) {
      throw new ConflictException(
        'Ya existe una serie global activa para este tipo de comprobante',
      );
    }

    const conflictingAssignment =
      await this.prisma.serieComprobanteSucursal.findFirst({
        where: {
          empresaId: params.empresaId,
          sucursalId: { in: params.sucursalIds },
          serieComprobante: {
            id: idFilter,
            tipoComprobante: params.tipoComprobante,
            activo: true,
          },
        },
        include: {
          sucursal: { select: { nombre: true } },
          serieComprobante: { select: { serie: true } },
        },
      });

    if (conflictingAssignment) {
      throw new ConflictException(
        `La sucursal ${conflictingAssignment.sucursal.nombre} ya tiene la serie ${conflictingAssignment.serieComprobante.serie} activa para este tipo de comprobante`,
      );
    }
  }

  private async validateSunatSalePrerequisites(
    empresaId: bigint,
    tipoComprobante: VentaTipoComprobante,
    cliente: {
      tipoDocumento: ClienteTipoDocumento;
      numeroDocumento: string | null;
      razonSocial: string | null;
    } | null,
  ) {
    const config = await this.prisma.sunatConfig.findUnique({
      where: { empresaId },
      include: { empresa: { select: { planCodigo: true } } },
    });

    if (!config?.activo) {
      throw new BadRequestException(
        'Activa la configuracion SUNAT de la empresa antes de emitir factura o boleta',
      );
    }

    assertSunatEnvironmentAllowed(config.empresa.planCodigo, config.ambiente);

    if (
      !config.usuarioSolEncrypted ||
      !config.claveSolEncrypted ||
      !config.certificadoR2Key ||
      !config.certificadoPasswordEncrypted
    ) {
      throw new BadRequestException(
        'Configura Usuario SOL, Clave SOL y certificado SUNAT antes de emitir',
      );
    }

    const billEndpoint = await this.prisma.sunatEndpointConfig.findUnique({
      where: {
        ambiente_codigo: {
          ambiente: config.ambiente,
          codigo: 'BILL_SERVICE',
        },
      },
      select: { activo: true },
    });

    if (!billEndpoint?.activo) {
      throw new BadRequestException(
        'No hay endpoint global BILL_SERVICE activo para el ambiente SUNAT',
      );
    }

    if (tipoComprobante === VentaTipoComprobante.factura) {
      if (
        !cliente ||
        cliente.tipoDocumento !== ClienteTipoDocumento.ruc ||
        !cliente.numeroDocumento ||
        cliente.numeroDocumento.length !== 11 ||
        !cliente.razonSocial?.trim()
      ) {
        throw new BadRequestException(
          'Para emitir factura el cliente debe tener RUC de 11 digitos y razon social',
        );
      }
    }
  }

  private validateElectronicSerie(
    tipoComprobante: VentaTipoComprobante,
    serie: string,
  ) {
    const normalized = serie.trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(normalized)) {
      throw new BadRequestException(
        'La serie debe tener exactamente 4 caracteres alfanumericos',
      );
    }

    if (
      (tipoComprobante === VentaTipoComprobante.factura ||
        tipoComprobante === VentaTipoComprobante.nota_credito_factura) &&
      !normalized.startsWith('F')
    ) {
      throw new BadRequestException(
        'La serie de factura o nota de credito debe iniciar con F',
      );
    }

    if (
      (tipoComprobante === VentaTipoComprobante.boleta ||
        tipoComprobante === VentaTipoComprobante.nota_credito_boleta) &&
      !normalized.startsWith('B')
    ) {
      throw new BadRequestException(
        'La serie de boleta o nota de credito debe iniciar con B',
      );
    }

    if (
      tipoComprobante === VentaTipoComprobante.guia_remision &&
      !/^T\d{3}$/.test(normalized)
    ) {
      throw new BadRequestException('La serie de guia debe tener formato T###');
    }
  }

  private toSerieResponse(
    serie: Prisma.SerieComprobanteGetPayload<{
      include: {
        sucursales: {
          include: {
            sucursal: { select: { id: true; nombre: true } };
          };
        };
      };
    }>,
  ) {
    return {
      id: serie.id.toString(),
      tipoComprobante: serie.tipoComprobante,
      serie: serie.serie,
      numeroActual: serie.numeroActual,
      esPrincipal: serie.esPrincipal,
      aplicaTodasSucursales: serie.aplicaTodasSucursales,
      sucursales: serie.sucursales.map((assignment) => ({
        id: assignment.sucursal.id.toString(),
        nombre: assignment.sucursal.nombre,
      })),
      activo: serie.activo,
      createdAt: serie.createdAt.toISOString(),
    };
  }

  private parseOptionalId(value: string | undefined, fieldName: string) {
    if (!value) {
      return null;
    }

    if (!/^\d+$/.test(String(value))) {
      throw new BadRequestException(`${fieldName} debe ser un id valido`);
    }

    return BigInt(value);
  }

  private parseDecimalAmount(value: string, fieldName: string) {
    try {
      const amount = new Prisma.Decimal(value);
      if (!amount.isFinite() || amount.lt(0)) {
        throw new Error('Invalid amount');
      }

      return amount;
    } catch {
      throw new BadRequestException(`${fieldName} debe ser un monto valido`);
    }
  }

  private cleanText(value: string) {
    return value.trim().replace(/\s+/g, ' ');
  }

  private buildNameKey(value: string) {
    return this.cleanText(value).toLowerCase();
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

  private toVentaResponse(venta: VentaWithRelations) {
    return {
      publicId: venta.publicId,
      tipoComprobante: venta.tipoComprobante,
      serie: venta.serie,
      numero: venta.numero,
      correlativo: venta.correlativo,
      estado: venta.estado,
      moneda: venta.moneda,
      formaPago: venta.formaPago,
      subtotal: venta.subtotal.toString(),
      descuentoTipo: venta.descuentoTipo,
      descuentoValor: venta.descuentoValor?.toString() ?? null,
      descuentoMonto: venta.descuentoMonto.toString(),
      igvPorcentaje: venta.igvPorcentaje.toString(),
      opGravadas: venta.opGravadas.toString(),
      opExoneradas: venta.opExoneradas.toString(),
      opInafectas: venta.opInafectas.toString(),
      igvMonto: venta.igvMonto.toString(),
      total: venta.total.toString(),
      sunat: {
        estado: venta.sunatEstado,
        codigo: venta.sunatCodigo,
        mensaje: venta.sunatMensaje,
        hash: venta.sunatHash,
        xmlDisponible: Boolean(venta.sunatXmlKey),
        cdrDisponible: Boolean(venta.sunatCdrKey),
        enviadoAt: venta.sunatEnviadoAt?.toISOString() ?? null,
        respondidoAt: venta.sunatRespondidoAt?.toISOString() ?? null,
      },
      sunatBaja: this.sunatBajaService.toPublicSunatBaja(venta),
      observaciones: venta.observaciones,
      anuladoAt: venta.anuladoAt?.toISOString() ?? null,
      anuladoRazon: venta.anuladoRazon,
      createdAt: venta.createdAt.toISOString(),
      sucursal: venta.sucursal
        ? {
            id: venta.sucursal.id.toString(),
            nombre: venta.sucursal.nombre,
          }
        : null,
      cliente: venta.cliente
        ? {
            id: venta.cliente.id.toString(),
            nombre: venta.cliente.nombre,
            tipoDocumento: venta.cliente.tipoDocumento,
            numeroDocumento: venta.cliente.numeroDocumento,
          }
        : null,
      serieComprobante: {
        id: venta.serieComprobante.id.toString(),
        serie: venta.serieComprobante.serie,
        tipoComprobante: venta.serieComprobante.tipoComprobante,
      },
      cajaSesion: venta.cajaSesion
        ? {
            publicId: venta.cajaSesion.publicId,
            estado: venta.cajaSesion.estado,
            openedAt: venta.cajaSesion.openedAt.toISOString(),
            closedAt: venta.cajaSesion.closedAt?.toISOString() ?? null,
          }
        : null,
      creadoPor: venta.creadoPor
        ? {
            id: venta.creadoPor.id.toString(),
            nombre: venta.creadoPor.nombre,
            apellido: venta.creadoPor.apellido,
          }
        : null,
      detalles: venta.detalles.map((d) => {
        const pv = d.productoVariante;
        const image = pv.productoColor.imagenes[0];
        return {
          id: d.id.toString(),
          descripcion: d.descripcion,
          cantidad: d.cantidad,
          unidadMedidaCodigo: d.unidadMedidaCodigo,
          tipoAfectacionIgvCodigo: d.tipoAfectacionIgvCodigo,
          precioUnitario: d.precioUnitario.toString(),
          valorUnitario: d.valorUnitario.toString(),
          descuentoTipo: d.descuentoTipo,
          descuentoValor: d.descuentoValor?.toString() ?? null,
          descuentoMonto: d.descuentoMonto.toString(),
          valorVenta: d.valorVenta.toString(),
          igvMonto: d.igvMonto.toString(),
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
      pagos: venta.pagos.map((p) => ({
        id: p.id.toString(),
        monto: p.monto.toString(),
        montoRecibido: p.montoRecibido?.toString() ?? null,
        vuelto: p.vuelto.toString(),
        referencia: p.referencia,
        estado: p.estado,
        metodoPago: {
          id: p.metodoPago.id.toString(),
          nombre: p.metodoPago.nombre,
          nombreKey: p.metodoPago.nombreKey,
          codigo: p.metodoPago.codigo,
          esSistema: p.metodoPago.esSistema,
          permiteVuelto: p.metodoPago.permiteVuelto,
        },
      })),
    };
  }

  private toSaleProductGroupResponse(
    product: SaleProductGroup,
    sucursalId: bigint | null,
    colorId: bigint | null,
    tallaId: bigint | null,
  ) {
    const variants = product.variantes.filter(
      (variant) =>
        (!colorId || variant.productoColor.colorId === colorId) &&
        (!tallaId || variant.tallaId === tallaId) &&
        (sucursalId
          ? (variant.inventarios.find(
              (inventory) => inventory.sucursalId === sucursalId,
            )?.stockActual ?? 0) > 0
          : variant.inventarios.reduce(
              (total, inventory) => total + inventory.stockActual,
              0,
            ) > 0),
    );
    const variantResponses = variants.map((variant) => {
      const image = variant.productoColor.imagenes[0];
      const stockTotal = variant.inventarios.reduce(
        (total, inventory) => total + inventory.stockActual,
        0,
      );
      const selectedInventory = sucursalId
        ? variant.inventarios.find(
            (inventory) => inventory.sucursalId === sucursalId,
          )
        : null;

      return {
        varianteId: variant.id.toString(),
        sku: variant.sku,
        codigoBarras: variant.codigoBarras,
        precioVenta: variant.precioVenta.toString(),
        precioMayorista: variant.precioMayorista?.toString() ?? null,
        stockTotal,
        stockSucursal: sucursalId
          ? (selectedInventory?.stockActual ?? 0)
          : null,
        imagen: image
          ? {
              id: image.id.toString(),
              urlOriginal: image.urlOriginal,
              urlWebp: image.urlWebp,
              urlThumbnail: image.urlThumbnail,
            }
          : null,
        color: {
          id: variant.productoColor.color.id.toString(),
          nombre: variant.productoColor.color.nombre,
          hex: variant.productoColor.color.hex,
        },
        talla: {
          id: variant.talla.id.toString(),
          nombre: variant.talla.nombre,
        },
      };
    });
    const prices = variantResponses.map((variant) =>
      Number(variant.precioVenta),
    );
    const representativeImage = variantResponses.find(
      (variant) => variant.imagen,
    )?.imagen;

    return {
      productoId: product.id.toString(),
      empresaId: product.empresaId.toString(),
      nombre: product.nombre,
      tipo: product.tipo,
      descripcion: product.descripcion,
      precioMinimo: Math.min(...prices).toFixed(2),
      precioMaximo: Math.max(...prices).toFixed(2),
      stockTotal: variantResponses.reduce(
        (total, variant) => total + variant.stockTotal,
        0,
      ),
      stockSucursal: sucursalId
        ? variantResponses.reduce(
            (total, variant) => total + (variant.stockSucursal ?? 0),
            0,
          )
        : null,
      imagen: representativeImage ?? null,
      cantidadVariantes: variantResponses.length,
      variantes: variantResponses,
      marca: product.marca
        ? {
            id: product.marca.id.toString(),
            nombre: product.marca.nombre,
          }
        : null,
      categoria: product.categoria
        ? {
            id: product.categoria.id.toString(),
            nombre: product.categoria.nombre,
          }
        : null,
      unidadMedida: {
        codigo: product.unidadMedida.codigo,
        descripcion: product.unidadMedida.descripcion,
      },
      tipoAfectacionIgv: {
        codigo: product.tipoAfectacionIgv.codigo,
        descripcion: product.tipoAfectacionIgv.descripcion,
      },
    };
  }
}
