import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StockMovimientoTipo, SucursalEstado } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  resolveScopedBranchId,
  type CommercialScope,
} from '../../common/commercial-access';
import { StockService } from '../stock/stock.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { FindPurchaseOrdersQueryDto } from './dto/find-purchase-orders-query.dto';
import { FindSuppliersQueryDto } from './dto/find-suppliers-query.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';

const orderInclude = {
  proveedor: true,
  destinoSucursal: { select: { id: true, nombre: true, tipo: true } },
  creadoPor: { select: { id: true, nombre: true, apellido: true } },
  detalles: {
    include: {
      productoVariante: {
        select: {
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
        },
      },
    },
    orderBy: { id: 'asc' as const },
  },
} satisfies Prisma.CompraOrdenInclude;

type OrderWithRelations = Prisma.CompraOrdenGetPayload<{
  include: typeof orderInclude;
}>;

@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stockService: StockService,
  ) {}

  async findSuppliers(empresaId: bigint, query: FindSuppliersQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 12;
    const search = query.search?.trim();
    const where: Prisma.ProveedorWhereInput = {
      empresaId,
      ...(query.activo === undefined ? {} : { activo: query.activo }),
      ...(search
        ? {
            OR: [
              { ruc: { contains: search } },
              { razonSocial: { contains: search, mode: 'insensitive' } },
              { nombreComercial: { contains: search, mode: 'insensitive' } },
              { telefono: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              { personaContacto: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total, activeTotal, inactiveTotal] =
      await this.prisma.$transaction([
        this.prisma.proveedor.findMany({
          where,
          orderBy: [{ activo: 'desc' }, { updatedAt: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.prisma.proveedor.count({ where }),
        this.prisma.proveedor.count({ where: { empresaId, activo: true } }),
        this.prisma.proveedor.count({ where: { empresaId, activo: false } }),
      ]);

    return {
      data: rows.map((row) => this.toSupplier(row)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        activeTotal,
        inactiveTotal,
      },
    };
  }

  async createSupplier(empresaId: bigint, dto: CreateSupplierDto) {
    const data = this.cleanSupplier(dto);
    try {
      const supplier = await this.prisma.proveedor.create({
        data: {
          empresaId,
          ruc: data.ruc ?? '',
          razonSocial: data.razonSocial ?? '',
          nombreComercial: data.nombreComercial,
          direccion: data.direccion,
          telefono: data.telefono,
          email: data.email,
          personaContacto: data.personaContacto,
          telefonoContacto: data.telefonoContacto,
          activo: data.activo,
        },
      });
      return this.toSupplier(supplier);
    } catch (error) {
      this.handleUniqueSupplier(error);
    }
  }

  async updateSupplier(empresaId: bigint, id: bigint, dto: UpdateSupplierDto) {
    await this.ensureSupplier(empresaId, id, false);
    try {
      const supplier = await this.prisma.proveedor.update({
        where: { id },
        data: this.cleanSupplier(dto, true),
      });
      return this.toSupplier(supplier);
    } catch (error) {
      this.handleUniqueSupplier(error);
    }
  }

  async removeSupplier(empresaId: bigint, id: bigint) {
    await this.ensureSupplier(empresaId, id, false);
    const supplier = await this.prisma.proveedor.update({
      where: { id },
      data: { activo: false },
    });
    return this.toSupplier(supplier);
  }

  async findOrders(
    empresaId: bigint,
    scope: CommercialScope,
    query: FindPurchaseOrdersQueryDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const search = query.search?.trim();
    const destinoSucursalId = resolveScopedBranchId(
      scope,
      query.destinoSucursalId,
    );
    const where: Prisma.CompraOrdenWhereInput = {
      empresaId,
      ...(destinoSucursalId ? { destinoSucursalId } : {}),
      ...(query.proveedorId ? { proveedorId: BigInt(query.proveedorId) } : {}),
      ...this.createdAtWhere(query.from, query.to),
      ...(search
        ? {
            OR: [
              { proveedorRuc: { contains: search } },
              {
                proveedorRazonSocial: { contains: search, mode: 'insensitive' },
              },
              { serie: { contains: search, mode: 'insensitive' } },
              { numero: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.compraOrden.findMany({
        where,
        include: orderInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.compraOrden.count({ where }),
    ]);

    return {
      data: rows.map((row) => this.toOrder(row)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async findOrder(empresaId: bigint, scope: CommercialScope, publicId: string) {
    const order = await this.prisma.compraOrden.findFirst({
      where: {
        empresaId,
        publicId,
        ...(scope.branchId ? { destinoSucursalId: scope.branchId } : {}),
      },
      include: orderInclude,
    });
    if (!order) throw new NotFoundException('Orden de compra no encontrada');
    return this.toOrder(order);
  }

  async createOrder(
    empresaId: bigint,
    scope: CommercialScope,
    dto: CreatePurchaseOrderDto,
  ) {
    const destinoSucursalId = resolveScopedBranchId(
      scope,
      dto.destinoSucursalId,
    );
    if (!destinoSucursalId) throw new BadRequestException('Selecciona destino');
    const items = this.cleanItems(dto.items);
    const document = this.cleanDocument(dto);

    const order = await this.prisma.$transaction(
      async (tx) => {
        const [supplier, branch, variantCount] = await Promise.all([
          tx.proveedor.findFirst({
            where: { id: BigInt(dto.proveedorId), empresaId, activo: true },
          }),
          tx.sucursal.findFirst({
            where: {
              id: destinoSucursalId,
              empresaId,
              estado: SucursalEstado.activo,
            },
          }),
          tx.productoVariante.count({
            where: {
              id: { in: items.map((item) => item.productoVarianteId) },
              empresaId,
              activo: true,
              deletedAt: null,
              producto: { activo: true, deletedAt: null },
            },
          }),
        ]);
        if (!supplier) throw new BadRequestException('Proveedor no disponible');
        if (!branch) throw new BadRequestException('Destino no disponible');
        if (variantCount !== items.length) {
          throw new BadRequestException(
            'Uno o mas productos no estan disponibles',
          );
        }
        if (document.tipoComprobante && document.serie && document.numero) {
          const duplicate = await tx.compraOrden.findFirst({
            where: {
              empresaId,
              tipoComprobante: document.tipoComprobante,
              serie: document.serie,
              numero: document.numero,
            },
            select: { id: true },
          });
          if (duplicate)
            throw new ConflictException('Ese comprobante ya fue registrado');
        }

        const total = items.reduce(
          (sum, item) => sum.plus(item.total),
          new Prisma.Decimal(0),
        );
        const created = await tx.compraOrden.create({
          data: {
            empresaId,
            proveedorId: supplier.id,
            destinoSucursalId,
            creadoPorId: scope.userId,
            proveedorRuc: supplier.ruc,
            proveedorRazonSocial: supplier.razonSocial,
            ...document,
            total,
            detalles: {
              create: items.map((item) => ({
                productoVarianteId: item.productoVarianteId,
                cantidad: item.cantidad,
                costoUnitario: item.costoUnitario,
                total: item.total,
              })),
            },
          },
        });

        for (const item of items) {
          await this.stockService.changeStock(tx, {
            empresaId,
            sucursalId: destinoSucursalId,
            productoVarianteId: item.productoVarianteId,
            delta: item.cantidad,
            tipo: StockMovimientoTipo.compra,
            motivo: `Orden de compra ${created.publicId}`,
            creadoPorId: scope.userId,
            referenciaTipo: 'compra_orden',
            referenciaId: created.id,
            costoUnitario: item.costoUnitario,
          });
        }

        return tx.compraOrden.findUniqueOrThrow({
          where: { id: created.id },
          include: orderInclude,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return this.toOrder(order);
  }

  private async ensureSupplier(
    empresaId: bigint,
    id: bigint,
    activeOnly = true,
  ) {
    const supplier = await this.prisma.proveedor.findFirst({
      where: { id, empresaId, ...(activeOnly ? { activo: true } : {}) },
    });
    if (!supplier) throw new NotFoundException('Proveedor no encontrado');
    return supplier;
  }

  private cleanSupplier(
    dto: CreateSupplierDto | UpdateSupplierDto,
    partial = false,
  ) {
    const ruc = dto.ruc?.replace(/\D/g, '') ?? '';
    const razonSocial = this.cleanText(dto.razonSocial);
    if (!partial || dto.ruc !== undefined) {
      if (!/^\d{11}$/.test(ruc))
        throw new BadRequestException('El RUC debe tener 11 digitos');
    }
    if (!partial || dto.razonSocial !== undefined) {
      if (!razonSocial)
        throw new BadRequestException('La razon social es obligatoria');
    }
    return {
      ...(dto.ruc === undefined ? {} : { ruc }),
      ...(dto.razonSocial === undefined
        ? {}
        : { razonSocial: razonSocial ?? '' }),
      ...(dto.nombreComercial === undefined
        ? {}
        : { nombreComercial: this.cleanText(dto.nombreComercial) }),
      ...(dto.direccion === undefined
        ? {}
        : { direccion: this.cleanText(dto.direccion) }),
      ...(dto.telefono === undefined
        ? {}
        : { telefono: this.cleanText(dto.telefono) }),
      ...(dto.email === undefined
        ? {}
        : { email: this.cleanText(dto.email)?.toLowerCase() ?? null }),
      ...(dto.personaContacto === undefined
        ? {}
        : { personaContacto: this.cleanText(dto.personaContacto) }),
      ...(dto.telefonoContacto === undefined
        ? {}
        : { telefonoContacto: this.cleanText(dto.telefonoContacto) }),
      ...(dto.activo === undefined ? {} : { activo: dto.activo }),
    };
  }

  private cleanDocument(dto: CreatePurchaseOrderDto) {
    return {
      tipoComprobante: dto.tipoComprobante || null,
      fechaEmision: dto.fechaEmision
        ? new Date(`${dto.fechaEmision}T00:00:00.000Z`)
        : null,
      serie: this.cleanText(dto.serie)?.toUpperCase() ?? null,
      numero: this.cleanText(dto.numero) ?? null,
    };
  }

  private cleanItems(dtoItems: CreatePurchaseOrderDto['items']) {
    const seen = new Set<string>();
    return dtoItems
      .map((item) => {
        if (seen.has(item.productoVarianteId)) {
          throw new BadRequestException('No repitas un producto en la orden');
        }
        seen.add(item.productoVarianteId);
        const costoUnitario = new Prisma.Decimal(item.costoUnitario);
        return {
          productoVarianteId: BigInt(item.productoVarianteId),
          cantidad: item.cantidad,
          costoUnitario,
          total: costoUnitario.mul(item.cantidad),
        };
      })
      .sort((a, b) =>
        a.productoVarianteId < b.productoVarianteId
          ? -1
          : a.productoVarianteId > b.productoVarianteId
            ? 1
            : 0,
      );
  }

  private createdAtWhere(from?: string, to?: string) {
    if (!from && !to) return {};
    const end = to ? new Date(to) : undefined;
    if (end && to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
      end.setUTCDate(end.getUTCDate() + 1);
    }
    return {
      createdAt: {
        ...(from ? { gte: new Date(from) } : {}),
        ...(end ? { lt: end } : {}),
      },
    };
  }

  private cleanText(value?: string) {
    return value?.trim().replace(/\s+/g, ' ') || null;
  }

  private handleUniqueSupplier(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('Ya existe un proveedor con ese RUC');
    }
    throw error;
  }

  private toSupplier(supplier: {
    id: bigint;
    empresaId: bigint;
    ruc: string;
    razonSocial: string;
    nombreComercial: string | null;
    direccion: string | null;
    telefono: string | null;
    email: string | null;
    personaContacto: string | null;
    telefonoContacto: string | null;
    activo: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: supplier.id.toString(),
      empresaId: supplier.empresaId.toString(),
      ruc: supplier.ruc,
      razonSocial: supplier.razonSocial,
      nombreComercial: supplier.nombreComercial,
      displayName: supplier.nombreComercial || supplier.razonSocial,
      direccion: supplier.direccion,
      telefono: supplier.telefono,
      email: supplier.email,
      personaContacto: supplier.personaContacto,
      telefonoContacto: supplier.telefonoContacto,
      activo: supplier.activo,
      createdAt: supplier.createdAt,
      updatedAt: supplier.updatedAt,
    };
  }

  private toOrder(order: OrderWithRelations) {
    return {
      id: order.id.toString(),
      publicId: order.publicId,
      proveedor: {
        id: order.proveedor.id.toString(),
        ruc: order.proveedorRuc,
        razonSocial: order.proveedorRazonSocial,
        displayName:
          order.proveedor.nombreComercial || order.proveedorRazonSocial,
      },
      destino: {
        id: order.destinoSucursal.id.toString(),
        nombre: order.destinoSucursal.nombre,
        tipo: order.destinoSucursal.tipo,
      },
      tipoComprobante: order.tipoComprobante,
      fechaEmision: order.fechaEmision,
      serie: order.serie,
      numero: order.numero,
      total: order.total.toString(),
      cantidadItems: order.detalles.length,
      cantidadTotal: order.detalles.reduce(
        (sum, item) => sum + item.cantidad,
        0,
      ),
      creadoPor: order.creadoPor
        ? {
            id: order.creadoPor.id.toString(),
            nombre: order.creadoPor.nombre,
            apellido: order.creadoPor.apellido,
          }
        : null,
      items: order.detalles.map((item) => ({
        id: item.id.toString(),
        cantidad: item.cantidad,
        costoUnitario: item.costoUnitario.toString(),
        total: item.total.toString(),
        producto: this.toProduct(item.productoVariante),
      })),
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }

  private toProduct(
    variant: OrderWithRelations['detalles'][number]['productoVariante'],
  ) {
    const normal = variant.producto.tipo === 'normal';
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
}
