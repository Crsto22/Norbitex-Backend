import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CajaMovimientoTipo,
  CajaSesionEstado,
  Prisma,
  SucursalTipo,
  VentaEstado,
  VentaTipoComprobante,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSaleDto } from './dto/create-sale.dto';
import { FindSalesQueryDto } from './dto/find-sales-query.dto';
import { FindSaleProductsQueryDto } from './dto/find-sale-products-query.dto';
import { AnnulSaleDto } from './dto/annul-sale.dto';
import { FindSeriesQueryDto } from './dto/find-series-query.dto';
import {
  CreateSerieComprobanteDto,
  UpdateSerieComprobanteDto,
} from './dto/serie-comprobante.dto';

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
  creadoPor: { select: { id: true, nombre: true, apellido: true } },
  detalles: {
    include: {
      productoVariante: {
        include: {
          producto: { select: { id: true, nombre: true, publicId: true } },
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

const saleProductInclude = {
  producto: {
    include: {
      marca: true,
      categoria: true,
      unidadMedida: true,
      tipoAfectacionIgv: true,
    },
  },
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
    include: {
      sucursal: true,
    },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.ProductoVarianteInclude;

type SaleProductVariant = Prisma.ProductoVarianteGetPayload<{
  include: typeof saleProductInclude;
}>;

@Injectable()
export class SalesService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Series ─────────────────────────────────────────────────────────

  async findSeries(empresaId: bigint, query: FindSeriesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? this.getDefaultPaginationLimit();
    const search = query.search?.trim();
    const sucursalId = this.parseOptionalId(query.sucursalId, 'sucursalId');

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
      ...(search
        ? { serie: { contains: search, mode: 'insensitive' } }
        : {}),
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
          serie: dto.serie.toUpperCase(),
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
          ...(dto.serie !== undefined
            ? { serie: dto.serie.toUpperCase() }
            : {}),
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

  async create(empresaId: bigint, userId: string, dto: CreateSaleDto) {
    const usuarioId = BigInt(userId);

    const sucursal = dto.sucursalId
      ? await this.prisma.sucursal.findFirst({
        where: { id: BigInt(dto.sucursalId), empresaId },
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

    if (dto.clienteId) {
      const cliente = await this.prisma.cliente.findFirst({
        where: { id: BigInt(dto.clienteId), empresaId },
      });
      if (!cliente) {
        throw new NotFoundException('Cliente no encontrado');
      }
    }

    const varianteIds = dto.detalles.map((d) =>
      BigInt(d.productoVarianteId),
    );
    const variantes = await this.prisma.productoVariante.findMany({
      where: {
        id: { in: varianteIds },
        empresaId,
        activo: true,
        deletedAt: null,
      },
    });

    if (variantes.length !== varianteIds.length) {
      throw new NotFoundException(
        'Una o mas variantes no encontradas',
      );
    }

    const varianteMap = new Map(
      variantes.map((v) => [v.id.toString(), v]),
    );

    const metodoPagoIds = dto.pagos.map((p) =>
      BigInt(p.metodoPagoId),
    );
    const metodosPago = await this.prisma.metodoPago.findMany({
      where: {
        id: { in: metodoPagoIds },
        empresaId,
        estado: 'activo',
        deletedAt: null,
      },
    });

    if (metodosPago.length !== metodoPagoIds.length) {
      throw new NotFoundException(
        'Uno o mas metodos de pago no encontrados',
      );
    }
    const metodoPagoMap = new Map(
      metodosPago.map((method) => [method.id.toString(), method]),
    );

    const serie = await this.resolveSerie(
      empresaId,
      dto.tipoComprobante,
      dto.sucursalId ? BigInt(dto.sucursalId) : null,
    );

    let subtotal = new Prisma.Decimal(0);
    const detallesData: Prisma.VentaDetalleUncheckedCreateWithoutVentaInput[] = [];

    for (const detalle of dto.detalles) {
      const variante = varianteMap.get(detalle.productoVarianteId)!;
      const precioUnitario = detalle.precioUnitario
        ? new Prisma.Decimal(detalle.precioUnitario)
        : variante.precioVenta;

      const cantidad = detalle.cantidad;
      const subtotalLinea = precioUnitario.mul(cantidad);
      let descuentoMonto = new Prisma.Decimal(0);

      if (detalle.descuentoTipo && detalle.descuentoValor) {
        const descuentoValor = new Prisma.Decimal(
          detalle.descuentoValor,
        );
        if (detalle.descuentoTipo === 'porcentaje') {
          descuentoMonto = subtotalLinea
            .mul(descuentoValor)
            .div(100);
        } else {
          descuentoMonto = descuentoValor;
        }
      }

      const totalLinea = subtotalLinea.sub(descuentoMonto);

      detallesData.push({
        productoVarianteId: BigInt(detalle.productoVarianteId),
        cantidad,
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

    if (dto.descuentoTipo && dto.descuentoValor) {
      const descuentoValor = new Prisma.Decimal(dto.descuentoValor);
      if (dto.descuentoTipo === 'porcentaje') {
        descuentoGlobalMonto = subtotal.mul(descuentoValor).div(100);
      } else {
        descuentoGlobalMonto = descuentoValor;
      }
    }

    const total = subtotal.sub(descuentoGlobalMonto);

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

    const venta = await this.prisma.$transaction(async (tx) => {
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
          sucursalId: dto.sucursalId
            ? BigInt(dto.sucursalId)
            : null,
          clienteId: dto.clienteId
            ? BigInt(dto.clienteId)
            : null,
          tipoComprobante: dto.tipoComprobante,
          serieComprobanteId: serie.id,
          serie: serie.serie,
          numero,
          correlativo,
          descuentoTipo: dto.descuentoTipo ?? null,
          descuentoValor: dto.descuentoValor
            ? new Prisma.Decimal(dto.descuentoValor)
            : null,
          subtotal,
          descuentoMonto: descuentoGlobalMonto,
          total,
          estado: VentaEstado.completada,
          observaciones: dto.observaciones ?? null,
          creadoPorId: usuarioId,
          cajaSesionId: cajaSesion?.id ?? null,
          detalles: {
            create: detallesData.map((d) => ({
              productoVarianteId: d.productoVarianteId,
              cantidad: d.cantidad,
              precioUnitario: d.precioUnitario,
              descuentoTipo: d.descuentoTipo,
              descuentoValor: d.descuentoValor,
              descuentoMonto: d.descuentoMonto,
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
          const inventory = await tx.inventarioSucursal.findUnique({
            where: {
              sucursalId_productoVarianteId: {
                sucursalId: sucursalIdBigint,
                productoVarianteId: detalle.productoVarianteId,
              },
            },
          });

          if (
            !inventory ||
            inventory.stockActual < detalle.cantidad
          ) {
            throw new BadRequestException(
              `Stock insuficiente para la variante ${detalle.productoVarianteId}`,
            );
          }

          await tx.inventarioSucursal.update({
            where: {
              sucursalId_productoVarianteId: {
                sucursalId: sucursalIdBigint,
                productoVarianteId: detalle.productoVarianteId,
              },
            },
            data: {
              stockActual: { decrement: detalle.cantidad },
            },
          });
        }
      }

      return ventaData;
    });

    return this.toVentaResponse(venta);
  }

  // ── Find All Sales ─────────────────────────────────────────────────

  async findAll(empresaId: bigint, query: FindSalesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? this.getDefaultPaginationLimit();
    const search = query.search?.trim();

    const where: Prisma.VentaWhereInput = {
      empresaId,
      ...(query.tipoComprobante
        ? { tipoComprobante: query.tipoComprobante }
        : {}),
      ...(query.estado ? { estado: query.estado } : {}),
      ...(query.sucursalId
        ? { sucursalId: BigInt(query.sucursalId) }
        : {}),
      ...(query.clienteId
        ? { clienteId: BigInt(query.clienteId) }
        : {}),
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

  // ── Find One Sale ──────────────────────────────────────────────────

  async findOne(empresaId: bigint, publicId: string) {
    const venta = await this.prisma.venta.findFirst({
      where: { publicId, empresaId },
      include: ventaInclude,
    });

    if (!venta) {
      throw new NotFoundException('Venta no encontrada');
    }

    return this.toVentaResponse(venta);
  }

  // ── Annul Sale ─────────────────────────────────────────────────────

  async annul(empresaId: bigint, publicId: string, dto: AnnulSaleDto) {
    const venta = await this.prisma.venta.findFirst({
      where: { publicId, empresaId },
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
          await tx.inventarioSucursal.update({
            where: {
              sucursalId_productoVarianteId: {
                sucursalId: venta.sucursalId!,
                productoVarianteId: detalle.productoVarianteId,
              },
            },
            data: {
              stockActual: { increment: detalle.cantidad },
            },
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
    query: FindSaleProductsQueryDto,
  ) {
    const page = query.page ?? 1;
    const limit =
      query.limit ?? this.getDefaultPaginationLimit();
    const search = query.search?.trim();
    const sucursalId = this.parseOptionalId(
      query.sucursalId,
      'sucursalId',
    );
    const categoriaId = this.parseOptionalId(
      query.categoriaId,
      'categoriaId',
    );
    const marcaId = this.parseOptionalId(
      query.marcaId,
      'marcaId',
    );
    const colorId = this.parseOptionalId(
      query.colorId,
      'colorId',
    );
    const tallaId = this.parseOptionalId(
      query.tallaId,
      'tallaId',
    );
    const where: Prisma.ProductoVarianteWhereInput = {
      empresaId,
      activo: true,
      deletedAt: null,
      producto: {
        empresaId,
        activo: true,
        deletedAt: null,
        ...(categoriaId ? { categoriaId } : {}),
        ...(marcaId ? { marcaId } : {}),
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
      ...(sucursalId
        ? {
            inventarios: {
              some: {
                empresaId,
                sucursalId,
                stockActual: { gt: 0 },
              },
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              {
                sku: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                codigoBarras: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                producto: {
                  nombre: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
              },
              {
                producto: {
                  nombreKey: {
                    contains: this.buildNameKey(search),
                  },
                },
              },
              {
                producto: {
                  descripcion: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
              },
              {
                producto: {
                  marca: {
                    nombre: {
                      contains: search,
                      mode: 'insensitive',
                    },
                  },
                },
              },
              {
                producto: {
                  categoria: {
                    nombre: {
                      contains: search,
                      mode: 'insensitive',
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [variants, total] = await this.prisma.$transaction([
      this.prisma.productoVariante.findMany({
        where,
        include: saleProductInclude,
        orderBy: [
          { producto: { nombre: 'asc' } },
          { productoColor: { color: { nombre: 'asc' } } },
          { talla: { nombre: 'asc' } },
        ],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.productoVariante.count({ where }),
    ]);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      data: variants.map((variant) =>
        this.toSaleProductResponse(variant, sucursalId),
      ),
      meta: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }

  // ── Private Helpers ────────────────────────────────────────────────

  private async resolveSerie(
    empresaId: bigint,
    tipoComprobante: VentaTipoComprobante,
    sucursalId: bigint | null,
  ): Promise<Prisma.SerieComprobanteGetPayload<{}>> {
    let serie: Prisma.SerieComprobanteGetPayload<{}> | null = null;

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
      serie =
        await this.prisma.serieComprobante.findFirst({
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
      serie =
        await this.prisma.serieComprobante.findFirst({
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
      throw new BadRequestException(
        'Debes seleccionar al menos una sucursal',
      );
    }

    for (const id of normalizedIds) {
      if (!/^\d+$/.test(id)) {
        throw new BadRequestException(
          'sucursalIds contiene un id invalido',
        );
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

  private parseOptionalId(
    value: string | undefined,
    fieldName: string,
  ) {
    if (!value) {
      return null;
    }

    if (!/^\d+$/.test(String(value))) {
      throw new BadRequestException(
        `${fieldName} debe ser un id valido`,
      );
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
      process.env.PAGINATION_DEFAULT_LIMIT ?? 12,
    );
    const maxLimit = Number(
      process.env.PAGINATION_MAX_LIMIT ?? 100,
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
      subtotal: venta.subtotal.toString(),
      descuentoTipo: venta.descuentoTipo,
      descuentoValor: venta.descuentoValor?.toString() ?? null,
      descuentoMonto: venta.descuentoMonto.toString(),
      total: venta.total.toString(),
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
        tipoComprobante:
          venta.serieComprobante.tipoComprobante,
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

  private toSaleProductResponse(
    variant: SaleProductVariant,
    sucursalId: bigint | null,
  ) {
    const image = variant.productoColor.imagenes[0];
    const stockTotal = variant.inventarios.reduce(
      (total, inventory) => total + inventory.stockActual,
      0,
    );
    const selectedInventory = sucursalId
      ? variant.inventarios.find(
          (inventory) =>
            inventory.sucursalId === sucursalId,
        )
      : null;
    const stockSucursal = sucursalId
      ? (selectedInventory?.stockActual ?? 0)
      : null;

    return {
      varianteId: variant.id.toString(),
      productoId: variant.productoId.toString(),
      empresaId: variant.empresaId.toString(),
      nombre: variant.producto.nombre,
      descripcion: variant.producto.descripcion,
      sku: variant.sku,
      codigoBarras: variant.codigoBarras,
      precioVenta: variant.precioVenta.toString(),
      precioMayorista:
        variant.precioMayorista?.toString() ?? null,
      stockTotal,
      stockSucursal,
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
      marca: variant.producto.marca
        ? {
            id: variant.producto.marca.id.toString(),
            nombre: variant.producto.marca.nombre,
          }
        : null,
      categoria: variant.producto.categoria
        ? {
            id: variant.producto.categoria.id.toString(),
            nombre: variant.producto.categoria.nombre,
          }
        : null,
      unidadMedida: {
        codigo: variant.producto.unidadMedida.codigo,
        descripcion:
          variant.producto.unidadMedida.descripcion,
      },
      tipoAfectacionIgv: {
        codigo:
          variant.producto.tipoAfectacionIgv.codigo,
        descripcion:
          variant.producto.tipoAfectacionIgv.descripcion,
      },
      sucursal: selectedInventory
        ? {
            id: selectedInventory.sucursal.id.toString(),
            nombre: selectedInventory.sucursal.nombre,
            tipo: selectedInventory.sucursal.tipo,
          }
        : null,
    };
  }
}
