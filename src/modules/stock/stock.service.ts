import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ProductoTipo,
  StockMovimientoDireccion,
  StockMovimientoTipo,
  SucursalEstado,
  SucursalTipo,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  resolveScopedBranchId,
  type CommercialScope,
} from '../../common/commercial-access';
import { CreateStockMovementDto } from './dto/create-stock-movement.dto';
import { CreateStockTransferDto } from './dto/create-stock-transfer.dto';
import { FindStockKardexVariantsQueryDto } from './dto/find-stock-kardex-variants-query.dto';
import { FindStockKardexQueryDto } from './dto/find-stock-kardex-query.dto';
import { FindStockMovementsQueryDto } from './dto/find-stock-movements-query.dto';
import { FindStockTransfersQueryDto } from './dto/find-stock-transfers-query.dto';

type ChangeStockInput = {
  empresaId: bigint;
  sucursalId: bigint;
  productoVarianteId: bigint;
  delta: number;
  tipo: StockMovimientoTipo;
  motivo?: string | null;
  creadoPorId?: bigint | null;
  referenciaTipo?: string | null;
  referenciaId?: bigint | null;
  traspasoId?: bigint | null;
  stockMinimo?: number;
  costoUnitario?: Prisma.Decimal.Value | null;
};

const productSelect = {
  id: true,
  publicId: true,
  sku: true,
  codigoBarras: true,
  producto: {
    select: { id: true, publicId: true, nombre: true, tipo: true },
  },
  productoColor: {
    select: { color: { select: { nombre: true, hex: true } } },
  },
  talla: { select: { nombre: true } },
} satisfies Prisma.ProductoVarianteSelect;

const kardexVariantSelect = {
  id: true,
  publicId: true,
  sku: true,
  codigoBarras: true,
  activo: true,
  precioCompra: true,
  precioVenta: true,
  producto: {
    select: {
      id: true,
      publicId: true,
      nombre: true,
      tipo: true,
      marca: { select: { id: true, nombre: true } },
      categoria: { select: { id: true, nombre: true } },
    },
  },
  productoColor: {
    select: {
      color: { select: { id: true, nombre: true, hex: true } },
      imagenes: {
        where: { esPrincipal: true },
        select: { urlThumbnail: true, urlWebp: true, urlOriginal: true },
        orderBy: { orden: 'asc' as const },
        take: 1,
      },
    },
  },
  talla: { select: { id: true, nombre: true } },
  inventarios: {
    select: {
      sucursalId: true,
      stockActual: true,
      sucursal: { select: { id: true, nombre: true, tipo: true } },
    },
  },
} satisfies Prisma.ProductoVarianteSelect;

const movementInclude = {
  sucursal: { select: { id: true, nombre: true, tipo: true } },
  productoVariante: { select: productSelect },
  creadoPor: { select: { id: true, nombre: true, apellido: true } },
  traspaso: { select: { publicId: true } },
} satisfies Prisma.StockMovimientoInclude;

const transferInclude = {
  origenSucursal: { select: { id: true, nombre: true, tipo: true } },
  destinoSucursal: { select: { id: true, nombre: true, tipo: true } },
  creadoPor: { select: { id: true, nombre: true, apellido: true } },
  detalles: {
    include: { productoVariante: { select: productSelect } },
    orderBy: { id: 'asc' as const },
  },
} satisfies Prisma.StockTraspasoInclude;

@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  async findLocations(empresaId: bigint, scope: CommercialScope) {
    const rows = await this.prisma.sucursal.findMany({
      where: {
        empresaId,
        estado: SucursalEstado.activo,
        tipo: { in: [SucursalTipo.tienda, SucursalTipo.almacen] },
      },
      select: { id: true, nombre: true, tipo: true },
      orderBy: [{ esPrincipal: 'desc' }, { nombre: 'asc' }],
    });
    return rows.map((row) => ({
      ...row,
      id: row.id.toString(),
      canUseAsOrigin: !scope.branchId || row.id === scope.branchId,
    }));
  }

  async findMovements(
    empresaId: bigint,
    scope: CommercialScope,
    query: FindStockMovementsQueryDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const scopedBranchId = resolveScopedBranchId(scope, query.sucursalId);
    const search = query.search?.trim();
    const where: Prisma.StockMovimientoWhereInput = {
      empresaId,
      ...(scopedBranchId ? { sucursalId: scopedBranchId } : {}),
      ...(query.productoId
        ? { productoVariante: { productoId: BigInt(query.productoId) } }
        : {}),
      ...(query.tipo ? { tipo: query.tipo } : {}),
      ...this.createdAtWhere(query.from, query.to),
      ...(search
        ? {
            OR: [
              { motivo: { contains: search, mode: 'insensitive' } },
              {
                sucursal: {
                  nombre: { contains: search, mode: 'insensitive' },
                },
              },
              {
                productoVariante: {
                  producto: {
                    nombre: { contains: search, mode: 'insensitive' },
                  },
                },
              },
              {
                productoVariante: {
                  sku: { contains: search, mode: 'insensitive' },
                },
              },
              {
                productoVariante: {
                  codigoBarras: { contains: search, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.stockMovimiento.findMany({
        where,
        include: movementInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.stockMovimiento.count({ where }),
    ]);

    return {
      data: rows.map((row) => this.toMovementResponse(row)),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async createMovement(
    empresaId: bigint,
    scope: CommercialScope,
    dto: CreateStockMovementDto,
  ) {
    const sucursalId = resolveScopedBranchId(scope, dto.sucursalId);
    if (!sucursalId) {
      throw new BadRequestException('Selecciona una ubicacion');
    }
    const items = this.cleanItems(dto.items);
    const motivo = dto.motivo.trim();

    const movements = await this.prisma.$transaction(
      async (tx) => {
        await this.ensureActiveBranches(tx, empresaId, [sucursalId]);
        await this.ensureVariants(
          tx,
          empresaId,
          items.map((item) => item.id),
        );
        await this.lockInventoryPairs(
          tx,
          items.map((item) => ({ sucursalId, varianteId: item.id })),
        );

        const result: Prisma.StockMovimientoGetPayload<{
          include: typeof movementInclude;
        }>[] = [];
        for (const item of items) {
          result.push(
            await this.changeStock(tx, {
              empresaId,
              sucursalId,
              productoVarianteId: item.id,
              delta:
                dto.direccion === StockMovimientoDireccion.entrada
                  ? item.cantidad
                  : -item.cantidad,
              tipo:
                dto.direccion === StockMovimientoDireccion.entrada
                  ? StockMovimientoTipo.entrada_manual
                  : StockMovimientoTipo.salida_manual,
              motivo,
              creadoPorId: scope.userId,
              costoUnitario: item.costoUnitario,
            }),
          );
        }
        return result;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return { data: movements.map((row) => this.toMovementResponse(row)) };
  }

  async findKardex(
    empresaId: bigint,
    scope: CommercialScope,
    query: FindStockKardexQueryDto,
  ) {
    if (!query.productoVarianteId) {
      throw new BadRequestException('Selecciona un producto');
    }
    return this.findKardexByVariantWhere(empresaId, scope, query, {
      id: BigInt(query.productoVarianteId),
    });
  }

  async findKardexByVariantPublicId(
    empresaId: bigint,
    scope: CommercialScope,
    variantPublicId: string,
    query: FindStockKardexQueryDto,
  ) {
    return this.findKardexByVariantWhere(empresaId, scope, query, {
      publicId: variantPublicId,
    });
  }

  async findKardexVariants(
    empresaId: bigint,
    scope: CommercialScope,
    query: FindStockKardexVariantsQueryDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 12;
    const scopedBranchId = resolveScopedBranchId(scope, query.sucursalId);
    const search = query.search?.trim();
    const where: Prisma.ProductoVarianteWhereInput = {
      empresaId,
      activo: true,
      deletedAt: null,
      producto: {
        deletedAt: null,
        activo: true,
        ...(query.categoriaId
          ? { categoriaId: BigInt(query.categoriaId) }
          : {}),
      },
      ...(query.colorId
        ? { productoColor: { colorId: BigInt(query.colorId), activo: true } }
        : {}),
      ...(query.tallaId ? { tallaId: BigInt(query.tallaId) } : {}),
      ...(scopedBranchId
        ? {
            inventarios: {
              some: {
                empresaId,
                sucursalId: scopedBranchId,
                stockActual: { gt: 0 },
              },
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { sku: { contains: search, mode: 'insensitive' } },
              { codigoBarras: { contains: search, mode: 'insensitive' } },
              {
                producto: {
                  nombre: { contains: search, mode: 'insensitive' },
                },
              },
              {
                productoColor: {
                  color: { nombre: { contains: search, mode: 'insensitive' } },
                },
              },
              { talla: { nombre: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.productoVariante.findMany({
        where,
        select: kardexVariantSelect,
        orderBy: [
          { producto: { nombre: 'asc' } },
          { productoColor: { color: { nombre: 'asc' } } },
          { talla: { nombre: 'asc' } },
          { id: 'asc' },
        ],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.productoVariante.count({ where }),
    ]);

    return {
      data: rows.map((row) =>
        this.toKardexVariantResponse(row, { sucursalId: scopedBranchId }),
      ),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  private async findKardexByVariantWhere(
    empresaId: bigint,
    scope: CommercialScope,
    query: FindStockKardexQueryDto,
    variantWhere: Pick<Prisma.ProductoVarianteWhereInput, 'id' | 'publicId'>,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 25;
    const scopedBranchId = resolveScopedBranchId(scope, query.sucursalId);
    const variant = await this.prisma.productoVariante.findFirst({
      where: {
        ...variantWhere,
        empresaId,
        activo: true,
        deletedAt: null,
        producto: { deletedAt: null },
      },
      select: productSelect,
    });
    if (!variant) throw new NotFoundException('Producto no encontrado');

    const where: Prisma.StockMovimientoWhereInput = {
      empresaId,
      productoVarianteId: variant.id,
      ...(scopedBranchId ? { sucursalId: scopedBranchId } : {}),
      ...this.createdAtWhere(query.from, query.to),
    };
    const beforeWhere: Prisma.StockMovimientoWhereInput = {
      empresaId,
      productoVarianteId: variant.id,
      ...(scopedBranchId ? { sucursalId: scopedBranchId } : {}),
      ...(query.from ? { createdAt: { lt: new Date(query.from) } } : {}),
    };

    const [rows, total, totals] = await this.prisma.$transaction([
      this.prisma.stockMovimiento.findMany({
        where,
        include: movementInclude,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.stockMovimiento.count({ where }),
      this.prisma.stockMovimiento.findMany({
        where,
        select: {
          direccion: true,
          cantidad: true,
          valorMovimiento: true,
        },
      }),
    ]);
    const previousRows = query.from
      ? await this.prisma.stockMovimiento.findMany({
          where: beforeWhere,
          orderBy: [
            { sucursalId: 'asc' },
            { createdAt: 'desc' },
            { id: 'desc' },
          ],
          distinct: ['sucursalId'],
          select: {
            stockPosterior: true,
            valorStockPosterior: true,
          },
        })
      : [];

    const saldoInicial = previousRows.reduce(
      (sum, row) => sum + row.stockPosterior,
      0,
    );
    const valorInicial = previousRows.reduce(
      (sum, row) => sum.plus(row.valorStockPosterior ?? 0),
      new Prisma.Decimal(0),
    );
    const entradas = totals
      .filter((row) => row.direccion === StockMovimientoDireccion.entrada)
      .reduce((sum, row) => sum + row.cantidad, 0);
    const salidas = totals
      .filter((row) => row.direccion === StockMovimientoDireccion.salida)
      .reduce((sum, row) => sum + row.cantidad, 0);
    const valorEntradas = totals
      .filter((row) => row.direccion === StockMovimientoDireccion.entrada)
      .reduce(
        (sum, row) => sum.plus(row.valorMovimiento ?? 0),
        new Prisma.Decimal(0),
      );
    const valorSalidas = totals
      .filter((row) => row.direccion === StockMovimientoDireccion.salida)
      .reduce(
        (sum, row) => sum.plus(row.valorMovimiento ?? 0),
        new Prisma.Decimal(0),
      );

    return {
      producto: this.toProduct(variant),
      sucursalId: scopedBranchId?.toString() ?? null,
      resumen: {
        saldoInicial,
        entradas,
        salidas,
        saldoFinal: saldoInicial + entradas - salidas,
        valorInicial: valorInicial.toString(),
        valorEntradas: valorEntradas.toString(),
        valorSalidas: valorSalidas.toString(),
        valorFinal: valorInicial
          .plus(valorEntradas)
          .minus(valorSalidas)
          .toString(),
      },
      data: rows.map((row) => this.toMovementResponse(row)),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async findTransfers(
    empresaId: bigint,
    scope: CommercialScope,
    query: FindStockTransfersQueryDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const search = query.search?.trim();
    const where: Prisma.StockTraspasoWhereInput = {
      empresaId,
      ...(scope.branchId
        ? {
            OR: [
              { origenSucursalId: scope.branchId },
              { destinoSucursalId: scope.branchId },
            ],
          }
        : {}),
      ...(query.origenSucursalId
        ? { origenSucursalId: BigInt(query.origenSucursalId) }
        : {}),
      ...(query.destinoSucursalId
        ? { destinoSucursalId: BigInt(query.destinoSucursalId) }
        : {}),
      ...this.createdAtWhere(query.from, query.to),
      ...(search
        ? {
            AND: [
              {
                OR: [
                  { motivo: { contains: search, mode: 'insensitive' } },
                  {
                    origenSucursal: {
                      nombre: { contains: search, mode: 'insensitive' },
                    },
                  },
                  {
                    destinoSucursal: {
                      nombre: { contains: search, mode: 'insensitive' },
                    },
                  },
                  {
                    detalles: {
                      some: {
                        productoVariante: {
                          producto: {
                            nombre: { contains: search, mode: 'insensitive' },
                          },
                        },
                      },
                    },
                  },
                ],
              },
            ],
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.stockTraspaso.findMany({
        where,
        include: transferInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.stockTraspaso.count({ where }),
    ]);

    return {
      data: rows.map((row) => this.toTransferResponse(row)),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  async findTransfer(
    empresaId: bigint,
    scope: CommercialScope,
    publicId: string,
  ) {
    const transfer = await this.prisma.stockTraspaso.findFirst({
      where: {
        empresaId,
        publicId,
        ...(scope.branchId
          ? {
              OR: [
                { origenSucursalId: scope.branchId },
                { destinoSucursalId: scope.branchId },
              ],
            }
          : {}),
      },
      include: transferInclude,
    });
    if (!transfer) throw new NotFoundException('Traspaso no encontrado');
    return this.toTransferResponse(transfer);
  }

  async createTransfer(
    empresaId: bigint,
    scope: CommercialScope,
    dto: CreateStockTransferDto,
  ) {
    const origenId = resolveScopedBranchId(scope, dto.origenSucursalId);
    if (!origenId) throw new BadRequestException('Selecciona el origen');
    const destinoId = BigInt(dto.destinoSucursalId);
    if (origenId === destinoId) {
      throw new ConflictException({
        code: 'SAME_LOCATION',
        message: 'El origen y el destino deben ser diferentes',
      });
    }
    const items = this.cleanItems(dto.items);
    const motivo = dto.motivo.trim();

    const transfer = await this.prisma.$transaction(
      async (tx) => {
        await this.ensureActiveBranches(tx, empresaId, [origenId, destinoId]);
        await this.ensureVariants(
          tx,
          empresaId,
          items.map((item) => item.id),
        );
        await this.lockInventoryPairs(
          tx,
          items.flatMap((item) => [
            { sucursalId: origenId, varianteId: item.id },
            { sucursalId: destinoId, varianteId: item.id },
          ]),
        );

        const created = await tx.stockTraspaso.create({
          data: {
            empresaId,
            origenSucursalId: origenId,
            destinoSucursalId: destinoId,
            motivo,
            creadoPorId: scope.userId,
            detalles: {
              create: items.map((item) => ({
                productoVarianteId: item.id,
                cantidad: item.cantidad,
              })),
            },
          },
        });

        for (const item of items) {
          const salida = await this.changeStock(tx, {
            empresaId,
            sucursalId: origenId,
            productoVarianteId: item.id,
            delta: -item.cantidad,
            tipo: StockMovimientoTipo.traspaso_salida,
            motivo,
            creadoPorId: scope.userId,
            referenciaTipo: 'traspaso',
            referenciaId: created.id,
            traspasoId: created.id,
          });
          await this.changeStock(tx, {
            empresaId,
            sucursalId: destinoId,
            productoVarianteId: item.id,
            delta: item.cantidad,
            tipo: StockMovimientoTipo.traspaso_entrada,
            motivo,
            creadoPorId: scope.userId,
            referenciaTipo: 'traspaso',
            referenciaId: created.id,
            traspasoId: created.id,
            costoUnitario: salida.costoUnitario,
          });
        }

        return tx.stockTraspaso.findUniqueOrThrow({
          where: { id: created.id },
          include: transferInclude,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return this.toTransferResponse(transfer);
  }

  async changeStock(tx: Prisma.TransactionClient, input: ChangeStockInput) {
    if (!Number.isInteger(input.delta) || input.delta === 0) {
      throw new BadRequestException('La variacion de stock debe ser un entero');
    }
    await this.lockInventoryPairs(tx, [
      { sucursalId: input.sucursalId, varianteId: input.productoVarianteId },
    ]);
    const current = await tx.inventarioSucursal.findUnique({
      where: {
        sucursalId_productoVarianteId: {
          sucursalId: input.sucursalId,
          productoVarianteId: input.productoVarianteId,
        },
      },
    });
    const stockAnterior = current?.stockActual ?? 0;
    const stockPosterior = stockAnterior + input.delta;
    if (stockPosterior < 0) {
      throw new ConflictException({
        code: 'INSUFFICIENT_STOCK',
        message: 'Stock insuficiente para completar la operacion',
        productoVarianteId: input.productoVarianteId.toString(),
        available: stockAnterior,
        requested: Math.abs(input.delta),
      });
    }

    const costoAnterior = new Prisma.Decimal(current?.costoPromedio ?? 0);
    const valorAnterior = new Prisma.Decimal(current?.valorStock ?? 0);
    const costoUnitario =
      input.delta > 0
        ? await this.resolveEntryCost(tx, input, costoAnterior)
        : costoAnterior;
    const valorMovimiento = costoUnitario.mul(Math.abs(input.delta));
    const valorPosterior =
      stockPosterior === 0
        ? new Prisma.Decimal(0)
        : input.delta > 0
          ? valorAnterior.plus(valorMovimiento)
          : valorAnterior.minus(valorMovimiento);
    const costoPosterior =
      stockPosterior > 0
        ? valorPosterior.div(stockPosterior)
        : new Prisma.Decimal(0);

    await tx.inventarioSucursal.upsert({
      where: {
        sucursalId_productoVarianteId: {
          sucursalId: input.sucursalId,
          productoVarianteId: input.productoVarianteId,
        },
      },
      create: {
        empresaId: input.empresaId,
        sucursalId: input.sucursalId,
        productoVarianteId: input.productoVarianteId,
        stockActual: stockPosterior,
        stockMinimo: input.stockMinimo ?? 0,
        costoPromedio: costoPosterior,
        valorStock: valorPosterior,
      },
      update: {
        stockActual: stockPosterior,
        costoPromedio: costoPosterior,
        valorStock: valorPosterior,
        ...(input.stockMinimo === undefined
          ? {}
          : { stockMinimo: input.stockMinimo }),
      },
    });

    return tx.stockMovimiento.create({
      data: {
        empresaId: input.empresaId,
        sucursalId: input.sucursalId,
        productoVarianteId: input.productoVarianteId,
        direccion:
          input.delta > 0
            ? StockMovimientoDireccion.entrada
            : StockMovimientoDireccion.salida,
        tipo: input.tipo,
        cantidad: Math.abs(input.delta),
        stockAnterior,
        stockPosterior,
        costoUnitario,
        costoPromedioAnterior: costoAnterior,
        costoPromedioPosterior: costoPosterior,
        valorMovimiento,
        valorStockAnterior: valorAnterior,
        valorStockPosterior: valorPosterior,
        motivo: input.motivo,
        creadoPorId: input.creadoPorId,
        referenciaTipo: input.referenciaTipo,
        referenciaId: input.referenciaId,
        traspasoId: input.traspasoId,
      },
      include: movementInclude,
    });
  }

  async setStock(
    tx: Prisma.TransactionClient,
    input: Omit<ChangeStockInput, 'delta'> & { stockActual: number },
  ) {
    await this.lockInventoryPairs(tx, [
      { sucursalId: input.sucursalId, varianteId: input.productoVarianteId },
    ]);
    const current = await tx.inventarioSucursal.findUnique({
      where: {
        sucursalId_productoVarianteId: {
          sucursalId: input.sucursalId,
          productoVarianteId: input.productoVarianteId,
        },
      },
    });
    const delta = input.stockActual - (current?.stockActual ?? 0);
    if (delta === 0) {
      const currentCost = new Prisma.Decimal(current?.costoPromedio ?? 0);
      return tx.inventarioSucursal.upsert({
        where: {
          sucursalId_productoVarianteId: {
            sucursalId: input.sucursalId,
            productoVarianteId: input.productoVarianteId,
          },
        },
        create: {
          empresaId: input.empresaId,
          sucursalId: input.sucursalId,
          productoVarianteId: input.productoVarianteId,
          stockActual: input.stockActual,
          stockMinimo: input.stockMinimo ?? 0,
          costoPromedio: currentCost,
          valorStock: currentCost.mul(input.stockActual),
        },
        update: {
          stockMinimo: input.stockMinimo ?? current?.stockMinimo ?? 0,
        },
      });
    }
    return this.changeStock(tx, { ...input, delta });
  }

  private async resolveEntryCost(
    tx: Prisma.TransactionClient,
    input: ChangeStockInput,
    currentCost: Prisma.Decimal,
  ) {
    if (input.costoUnitario !== undefined && input.costoUnitario !== null) {
      return new Prisma.Decimal(input.costoUnitario);
    }
    const variant = await tx.productoVariante.findUnique({
      where: { id: input.productoVarianteId },
      select: { precioCompra: true },
    });
    return new Prisma.Decimal(variant?.precioCompra ?? currentCost);
  }

  private async ensureActiveBranches(
    tx: Prisma.TransactionClient,
    empresaId: bigint,
    ids: bigint[],
  ) {
    const uniqueIds = [...new Set(ids.map(String))].map(BigInt);
    const count = await tx.sucursal.count({
      where: {
        id: { in: uniqueIds },
        empresaId,
        estado: SucursalEstado.activo,
        tipo: { in: [SucursalTipo.tienda, SucursalTipo.almacen] },
      },
    });
    if (count !== uniqueIds.length) {
      throw new ConflictException({
        code: 'LOCATION_INACTIVE',
        message:
          'La ubicacion no existe, esta inactiva o pertenece a otra empresa',
      });
    }
  }

  private async ensureVariants(
    tx: Prisma.TransactionClient,
    empresaId: bigint,
    ids: bigint[],
  ) {
    const count = await tx.productoVariante.count({
      where: {
        id: { in: ids },
        empresaId,
        activo: true,
        deletedAt: null,
        producto: { activo: true, deletedAt: null },
      },
    });
    if (count !== ids.length) {
      throw new BadRequestException('Uno o mas productos no estan disponibles');
    }
  }

  private cleanItems(
    items: Array<{
      productoVarianteId: string;
      cantidad: number;
      costoUnitario?: number;
    }>,
  ) {
    const seen = new Set<string>();
    const cleaned = items.map((item) => {
      if (seen.has(item.productoVarianteId)) {
        throw new BadRequestException('No repitas un producto en la operacion');
      }
      seen.add(item.productoVarianteId);
      return {
        id: BigInt(item.productoVarianteId),
        cantidad: item.cantidad,
        costoUnitario: item.costoUnitario,
      };
    });
    return cleaned.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  private async lockInventoryPairs(
    tx: Prisma.TransactionClient,
    pairs: Array<{ sucursalId: bigint; varianteId: bigint }>,
  ) {
    const unique = new Map(
      pairs.map((pair) => [`${pair.sucursalId}:${pair.varianteId}`, pair]),
    );
    const ordered = [...unique.values()].sort((a, b) => {
      if (a.sucursalId !== b.sucursalId)
        return a.sucursalId < b.sucursalId ? -1 : 1;
      return a.varianteId < b.varianteId
        ? -1
        : a.varianteId > b.varianteId
          ? 1
          : 0;
    });
    for (const pair of ordered) {
      await tx.$queryRaw(Prisma.sql`
        SELECT "id" FROM "inventario_sucursal"
        WHERE "sucursal_id" = ${pair.sucursalId}
          AND "producto_variante_id" = ${pair.varianteId}
        FOR UPDATE
      `);
    }
  }

  private createdAtWhere(from?: string, to?: string) {
    if (!from && !to) return {};
    const end = to ? new Date(to) : undefined;
    if (end && /^\d{4}-\d{2}-\d{2}$/.test(to!))
      end.setUTCDate(end.getUTCDate() + 1);
    return {
      createdAt: {
        ...(from ? { gte: new Date(from) } : {}),
        ...(end ? { lt: end } : {}),
      },
    };
  }

  private toProduct(variant: {
    id: bigint;
    publicId: string;
    sku: string | null;
    codigoBarras: string | null;
    producto: {
      id: bigint;
      publicId: string;
      nombre: string;
      tipo: ProductoTipo;
    };
    productoColor: { color: { nombre: string; hex: string } };
    talla: { nombre: string };
  }) {
    const normal = variant.producto.tipo === ProductoTipo.normal;
    return {
      productoVarianteId: variant.id.toString(),
      productoVariantePublicId: variant.publicId,
      productoId: variant.producto.id.toString(),
      productoPublicId: variant.producto.publicId,
      nombre: variant.producto.nombre,
      tipo: variant.producto.tipo,
      sku: variant.sku,
      codigoBarras: variant.codigoBarras,
      color: normal ? null : variant.productoColor.color,
      talla: normal ? null : variant.talla.nombre,
    };
  }

  private toKardexVariantResponse(
    variant: Prisma.ProductoVarianteGetPayload<{
      select: typeof kardexVariantSelect;
    }>,
    options: { sucursalId?: bigint | null } = {},
  ) {
    const normal = variant.producto.tipo === ProductoTipo.normal;
    const inventories = options.sucursalId
      ? variant.inventarios.filter(
          (inventory) => inventory.sucursalId === options.sucursalId,
        )
      : variant.inventarios;
    const image = variant.productoColor.imagenes[0] ?? null;

    return {
      id: variant.id.toString(),
      variantPublicId: variant.publicId,
      productoId: variant.producto.id.toString(),
      productoPublicId: variant.producto.publicId,
      nombre: variant.producto.nombre,
      tipo: variant.producto.tipo,
      sku: variant.sku,
      codigoBarras: variant.codigoBarras,
      precioCompra: variant.precioCompra?.toString() ?? null,
      precioVenta: variant.precioVenta.toString(),
      activo: variant.activo,
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
      color: normal
        ? null
        : {
            id: variant.productoColor.color.id.toString(),
            nombre: variant.productoColor.color.nombre,
            hex: variant.productoColor.color.hex,
          },
      talla: normal
        ? null
        : {
            id: variant.talla.id.toString(),
            nombre: variant.talla.nombre,
          },
      imageUrl:
        image?.urlThumbnail ?? image?.urlWebp ?? image?.urlOriginal ?? null,
      stockTotal: variant.inventarios.reduce(
        (total, inventory) => total + inventory.stockActual,
        0,
      ),
      stockSucursal: options.sucursalId
        ? inventories.reduce(
            (total, inventory) => total + inventory.stockActual,
            0,
          )
        : null,
      inventarios: inventories.map((inventory) => ({
        sucursal: {
          id: inventory.sucursal.id.toString(),
          nombre: inventory.sucursal.nombre,
          tipo: inventory.sucursal.tipo,
        },
        stockActual: inventory.stockActual,
      })),
    };
  }

  private toMovementResponse(
    row: Prisma.StockMovimientoGetPayload<{ include: typeof movementInclude }>,
  ) {
    return {
      id: row.id.toString(),
      direccion: row.direccion,
      tipo: row.tipo,
      cantidad: row.cantidad,
      stockAnterior: row.stockAnterior,
      stockPosterior: row.stockPosterior,
      costoUnitario: row.costoUnitario?.toString() ?? null,
      costoPromedioAnterior: row.costoPromedioAnterior?.toString() ?? null,
      costoPromedioPosterior: row.costoPromedioPosterior?.toString() ?? null,
      valorMovimiento: row.valorMovimiento?.toString() ?? null,
      valorStockAnterior: row.valorStockAnterior?.toString() ?? null,
      valorStockPosterior: row.valorStockPosterior?.toString() ?? null,
      motivo: row.motivo,
      referenciaTipo: row.referenciaTipo,
      referenciaId: row.referenciaId?.toString() ?? null,
      traspasoPublicId: row.traspaso?.publicId ?? null,
      sucursal: { ...row.sucursal, id: row.sucursal.id.toString() },
      producto: this.toProduct(row.productoVariante),
      creadoPor: row.creadoPor
        ? { ...row.creadoPor, id: row.creadoPor.id.toString() }
        : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toTransferResponse(
    row: Prisma.StockTraspasoGetPayload<{ include: typeof transferInclude }>,
  ) {
    return {
      id: row.id.toString(),
      publicId: row.publicId,
      motivo: row.motivo,
      origen: { ...row.origenSucursal, id: row.origenSucursal.id.toString() },
      destino: {
        ...row.destinoSucursal,
        id: row.destinoSucursal.id.toString(),
      },
      creadoPor: row.creadoPor
        ? { ...row.creadoPor, id: row.creadoPor.id.toString() }
        : null,
      items: row.detalles.map((detail) => ({
        id: detail.id.toString(),
        cantidad: detail.cantidad,
        producto: this.toProduct(detail.productoVariante),
      })),
      cantidadTotal: row.detalles.reduce(
        (sum, detail) => sum + detail.cantidad,
        0,
      ),
      createdAt: row.createdAt.toISOString(),
    };
  }
}
