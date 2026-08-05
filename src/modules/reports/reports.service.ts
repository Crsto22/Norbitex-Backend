import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ClienteEstado,
  EmpresaUsuarioEstado,
  Prisma,
  ProductoTipo,
  SucursalTipo,
  UsuarioEstado,
  VentaEstado,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  resolveScopedBranchId,
  scopedCreatorId,
  type CommercialScope,
} from '../../common/commercial-access';
import {
  FindReportQueryDto,
  ReportDateFilter,
} from './dto/find-report-query.dto';

type DateRange = { start: Date; end: Date };
type TimeBucket = DateRange & { key: string; label: string };
type ReportContext = {
  sucursalId: bigint | null;
  creatorId: bigint | null;
  dateFilter: ReportDateFilter;
  range: DateRange;
};

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async findSales(
    empresaId: bigint,
    scope: CommercialScope,
    query: FindReportQueryDto,
  ) {
    const context = await this.resolveContext(empresaId, scope, query, true);
    const baseWhere = this.buildSaleWhere(
      empresaId,
      context.sucursalId,
      context.creatorId,
    );
    const completedWhere = {
      ...baseWhere,
      estado: VentaEstado.completada,
    } satisfies Prisma.VentaWhereInput;
    const selectedCompletedWhere = {
      ...completedWhere,
      createdAt: { gte: context.range.start, lte: context.range.end },
    } satisfies Prisma.VentaWhereInput;
    const selectedAnnulledWhere = {
      ...baseWhere,
      estado: VentaEstado.anulada,
      createdAt: { gte: context.range.start, lte: context.range.end },
    } satisfies Prisma.VentaWhereInput;
    const todayRange = this.getDateRange('today');
    const monthRange = this.getCurrentMonthRange();

    const [
      todayAggregate,
      monthAggregate,
      selectedAggregate,
      emittedCount,
      voidedCount,
      trendSales,
      documentGroups,
      branchGroups,
    ] = await Promise.all([
      this.prisma.venta.aggregate({
        where: {
          ...completedWhere,
          createdAt: { gte: todayRange.start, lte: todayRange.end },
        },
        _sum: { total: true },
      }),
      this.prisma.venta.aggregate({
        where: {
          ...completedWhere,
          createdAt: { gte: monthRange.start, lte: monthRange.end },
        },
        _sum: { total: true },
      }),
      this.prisma.venta.aggregate({
        where: selectedCompletedWhere,
        _avg: { total: true },
      }),
      this.prisma.venta.count({ where: selectedCompletedWhere }),
      this.prisma.venta.count({ where: selectedAnnulledWhere }),
      this.prisma.venta.findMany({
        where: selectedCompletedWhere,
        select: { createdAt: true, total: true },
      }),
      this.prisma.venta.groupBy({
        by: ['tipoComprobante'],
        where: selectedCompletedWhere,
        _count: { _all: true },
        _sum: { total: true },
        orderBy: { tipoComprobante: 'asc' },
      }),
      this.prisma.venta.groupBy({
        by: ['sucursalId'],
        where: selectedCompletedWhere,
        _sum: { total: true },
        orderBy: { sucursalId: 'asc' },
      }),
    ]);

    const buckets = this.getTrendBuckets(context.dateFilter, context.range);
    const salesByBranch = await this.buildSalesByBranch(
      empresaId,
      branchGroups,
    );

    return {
      filters: this.toFilters(context),
      summary: {
        todaySalesTotal: this.decimalToString(todayAggregate._sum.total),
        monthSalesTotal: this.decimalToString(monthAggregate._sum.total),
        averageTicket: this.decimalToString(selectedAggregate._avg.total),
        emittedCount,
        voidedCount,
      },
      salesTrend: {
        granularity:
          context.dateFilter === 'today' ? ('hour' as const) : ('day' as const),
        data: this.aggregateSalesTrend(trendSales, buckets),
      },
      salesByDocumentType: documentGroups
        .map((group) => ({
          type: group.tipoComprobante,
          count: group._count._all,
          amount: this.decimalToString(group._sum.total),
        }))
        .sort((a, b) => b.count - a.count),
      salesByBranch,
    };
  }

  async findProducts(
    empresaId: bigint,
    scope: CommercialScope,
    query: FindReportQueryDto,
  ) {
    const context = await this.resolveContext(empresaId, scope, query);
    const completedWhere = {
      ...this.buildSaleWhere(empresaId, context.sucursalId, context.creatorId),
      estado: VentaEstado.completada,
      createdAt: { gte: context.range.start, lte: context.range.end },
    } satisfies Prisma.VentaWhereInput;
    const inventoryScope = context.sucursalId
      ? { inventarios: { some: { sucursalId: context.sucursalId } } }
      : {};
    const activeVariantWhere = {
      empresaId,
      activo: true,
      deletedAt: null,
      producto: {
        activo: true,
        deletedAt: null,
        tipo: ProductoTipo.variantes,
      },
      ...inventoryScope,
    } satisfies Prisma.ProductoVarianteWhereInput;
    const activeProductWhere = {
      empresaId,
      activo: true,
      deletedAt: null,
      variantes: {
        some: {
          activo: true,
          deletedAt: null,
          ...inventoryScope,
        },
      },
    } satisfies Prisma.ProductoWhereInput;

    const [
      activeProducts,
      activeVariants,
      inventoryVariants,
      unitsAggregate,
      topUnitsGroups,
      topAmountGroups,
    ] = await Promise.all([
      this.prisma.producto.count({ where: activeProductWhere }),
      this.prisma.productoVariante.count({ where: activeVariantWhere }),
      this.prisma.productoVariante.findMany({
        where: activeVariantWhere,
        select: {
          id: true,
          inventarios: {
            where: context.sucursalId
              ? { sucursalId: context.sucursalId }
              : undefined,
            select: { stockActual: true },
          },
        },
      }),
      this.prisma.ventaDetalle.aggregate({
        where: {
          venta: completedWhere,
          productoVariante: {
            producto: { tipo: ProductoTipo.variantes },
          },
        },
        _sum: { cantidad: true },
      }),
      this.prisma.ventaDetalle.groupBy({
        by: ['productoVarianteId'],
        where: { venta: completedWhere },
        _sum: { cantidad: true, total: true },
        orderBy: { _sum: { cantidad: 'desc' } },
        take: 8,
      }),
      this.prisma.ventaDetalle.groupBy({
        by: ['productoVarianteId'],
        where: { venta: completedWhere },
        _sum: { cantidad: true, total: true },
        orderBy: { _sum: { total: 'desc' } },
        take: 6,
      }),
    ]);

    const variantIds = Array.from(
      new Set(
        [...topUnitsGroups, ...topAmountGroups].map((group) =>
          group.productoVarianteId.toString(),
        ),
      ),
      (id) => BigInt(id),
    );
    const variants = await this.prisma.productoVariante.findMany({
      where: { empresaId, id: { in: variantIds } },
      include: {
        producto: { select: { nombre: true, tipo: true } },
        productoColor: {
          include: { color: { select: { nombre: true, hex: true } } },
        },
        talla: { select: { nombre: true } },
      },
    });
    const variantMap = new Map(
      variants.map((variant) => [variant.id.toString(), variant]),
    );
    const outOfStockVariants = inventoryVariants.filter(
      (variant) =>
        variant.inventarios.reduce(
          (sum, inventory) => sum + inventory.stockActual,
          0,
        ) <= 0,
    ).length;
    const unitsSold = unitsAggregate._sum.cantidad ?? 0;

    return {
      filters: this.toFilters(context),
      summary: {
        activeProducts,
        activeVariants,
        outOfStockVariants,
        averageTurnover:
          activeVariants > 0
            ? Number((unitsSold / activeVariants).toFixed(2))
            : 0,
      },
      topByUnits: this.buildVariantRanking(topUnitsGroups, variantMap),
      topByAmount: this.buildVariantRanking(topAmountGroups, variantMap),
    };
  }

  async findClients(
    empresaId: bigint,
    scope: CommercialScope,
    query: FindReportQueryDto,
  ) {
    const context = await this.resolveContext(empresaId, scope, query, true);
    const completedWhere = {
      ...this.buildSaleWhere(empresaId, context.sucursalId, context.creatorId),
      estado: VentaEstado.completada,
      createdAt: { gte: context.range.start, lte: context.range.end },
      clienteId: { not: null },
    } satisfies Prisma.VentaWhereInput;
    const monthRange = this.getCurrentMonthRange();

    const [activeClients, newClientsThisMonth, purchaseGroups] =
      await Promise.all([
        this.prisma.cliente.count({
          where: { empresaId, estado: ClienteEstado.activo },
        }),
        this.prisma.cliente.count({
          where: {
            empresaId,
            createdAt: { gte: monthRange.start, lte: monthRange.end },
          },
        }),
        this.prisma.venta.groupBy({
          by: ['clienteId'],
          where: completedWhere,
          _count: { _all: true },
          _sum: { total: true },
        }),
      ]);

    const clientIds = purchaseGroups.flatMap((group) =>
      group.clienteId ? [group.clienteId] : [],
    );
    const clients = await this.prisma.cliente.findMany({
      where: { empresaId, id: { in: clientIds } },
      select: {
        id: true,
        nombre: true,
        razonSocial: true,
        numeroDocumento: true,
      },
    });
    const clientMap = new Map(
      clients.map((client) => [client.id.toString(), client]),
    );
    const ranking = purchaseGroups.flatMap((group) => {
      if (!group.clienteId) {
        return [];
      }

      const client = clientMap.get(group.clienteId.toString());
      return [
        {
          clientId: group.clienteId.toString(),
          name:
            client?.razonSocial ??
            client?.nombre ??
            client?.numeroDocumento ??
            `Cliente ${group.clienteId.toString()}`,
          purchases: group._count._all,
          amount: this.decimalToString(group._sum.total),
        },
      ];
    });
    const recurringClients = ranking.filter(
      (client) => client.purchases >= 2,
    ).length;

    return {
      filters: this.toFilters(context),
      summary: {
        activeClients,
        newClientsThisMonth,
        recurrenceRate:
          ranking.length > 0
            ? Number(((recurringClients / ranking.length) * 100).toFixed(2))
            : 0,
      },
      topByPurchases: [...ranking]
        .sort(
          (a, b) =>
            b.purchases - a.purchases || Number(b.amount) - Number(a.amount),
        )
        .slice(0, 8),
      topByAmount: [...ranking]
        .sort(
          (a, b) =>
            Number(b.amount) - Number(a.amount) || b.purchases - a.purchases,
        )
        .slice(0, 6),
    };
  }

  async findUsers(
    empresaId: bigint,
    scope: CommercialScope,
    query: FindReportQueryDto,
  ) {
    const context = await this.resolveContext(empresaId, scope, query, true);
    const baseWhere = this.buildSaleWhere(
      empresaId,
      context.sucursalId,
      context.creatorId,
    );
    const selectedCompletedWhere = {
      ...baseWhere,
      estado: VentaEstado.completada,
      createdAt: { gte: context.range.start, lte: context.range.end },
    } satisfies Prisma.VentaWhereInput;
    const selectedAnnulledWhere = {
      ...baseWhere,
      estado: VentaEstado.anulada,
      anuladoAt: { gte: context.range.start, lte: context.range.end },
    } satisfies Prisma.VentaWhereInput;

    const [
      companyUsers,
      salesGroups,
      cancellationGroups,
      completedSales,
      annulledSales,
    ] = await Promise.all([
      this.prisma.empresaUsuario.findMany({
        where: {
          empresaId,
          ...(context.creatorId ? { usuarioId: context.creatorId } : {}),
          estado: EmpresaUsuarioEstado.activo,
          usuario: { estado: UsuarioEstado.activo },
        },
        include: { usuario: true },
        orderBy: { usuario: { nombre: 'asc' } },
      }),
      this.prisma.venta.groupBy({
        by: ['creadoPorId'],
        where: {
          ...selectedCompletedWhere,
          creadoPorId: { not: null },
        },
        _count: { _all: true },
        _sum: { total: true },
        _avg: { total: true },
      }),
      this.prisma.venta.groupBy({
        by: ['creadoPorId'],
        where: {
          ...selectedAnnulledWhere,
          creadoPorId: { not: null },
        },
        _count: { _all: true },
        _sum: { total: true },
      }),
      this.prisma.venta.findMany({
        where: selectedCompletedWhere,
        select: { createdAt: true, total: true },
      }),
      this.prisma.venta.findMany({
        where: selectedAnnulledWhere,
        select: { anuladoAt: true, total: true },
      }),
    ]);

    const salesMap = new Map(
      salesGroups.flatMap((group) =>
        group.creadoPorId
          ? [[group.creadoPorId.toString(), group] as const]
          : [],
      ),
    );
    const cancellationsMap = new Map(
      cancellationGroups.flatMap((group) =>
        group.creadoPorId
          ? [[group.creadoPorId.toString(), group] as const]
          : [],
      ),
    );
    const userKpis = companyUsers.map((companyUser) => {
      const userId = companyUser.usuarioId.toString();
      const sales = salesMap.get(userId);
      return {
        empresaUsuarioId: companyUser.id.toString(),
        userId,
        name: [companyUser.usuario.nombre, companyUser.usuario.apellido]
          .filter(Boolean)
          .join(' '),
        amount: this.decimalToString(sales?._sum.total),
        sales: sales?._count._all ?? 0,
        averageTicket: this.decimalToString(sales?._avg.total),
      };
    });
    const cancellations = companyUsers.map((companyUser) => {
      const userId = companyUser.usuarioId.toString();
      const group = cancellationsMap.get(userId);
      return {
        empresaUsuarioId: companyUser.id.toString(),
        userId,
        name: [companyUser.usuario.nombre, companyUser.usuario.apellido]
          .filter(Boolean)
          .join(' '),
        count: group?._count._all ?? 0,
        amount: this.decimalToString(group?._sum.total),
      };
    });

    return {
      filters: this.toFilters(context),
      userKpis,
      cancellations,
      dailyEvolution: this.buildDailyEvolution(
        context.range,
        completedSales,
        annulledSales,
      ),
    };
  }

  private async resolveContext(
    empresaId: bigint,
    scope: CommercialScope,
    query: FindReportQueryDto,
    storesOnly = false,
  ): Promise<ReportContext> {
    const dateFilter = query.dateFilter ?? 'today';
    const sucursalId = resolveScopedBranchId(scope, query.sucursalId);
    await this.validateSucursalId(empresaId, sucursalId, storesOnly);

    return {
      sucursalId,
      creatorId: scopedCreatorId(scope),
      dateFilter,
      range: this.getDateRange(dateFilter),
    };
  }

  private async validateSucursalId(
    empresaId: bigint,
    sucursalId: bigint | null,
    storesOnly: boolean,
  ) {
    if (!sucursalId) return;
    const branch = await this.prisma.sucursal.findFirst({
      where: {
        id: sucursalId,
        empresaId,
        ...(storesOnly ? { tipo: SucursalTipo.tienda } : {}),
      },
      select: { id: true },
    });

    if (!branch) {
      throw new NotFoundException('Sucursal no encontrada');
    }
  }

  private buildSaleWhere(
    empresaId: bigint,
    sucursalId: bigint | null,
    creatorId: bigint | null,
  ): Prisma.VentaWhereInput {
    return {
      empresaId,
      ...(sucursalId ? { sucursalId } : {}),
      ...(creatorId ? { creadoPorId: creatorId } : {}),
    };
  }

  private getDateRange(filter: ReportDateFilter): DateRange {
    const end = new Date();
    const start = new Date(end);
    start.setHours(0, 0, 0, 0);

    if (filter !== 'today') {
      const days = filter === '7days' ? 7 : filter === '14days' ? 14 : 30;
      start.setDate(start.getDate() - (days - 1));
    }

    return { start, end };
  }

  private getCurrentMonthRange(): DateRange {
    const now = new Date();
    return {
      start: new Date(now.getFullYear(), now.getMonth(), 1),
      end: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999),
    };
  }

  private getTrendBuckets(
    filter: ReportDateFilter,
    range: DateRange,
  ): TimeBucket[] {
    if (filter === 'today') {
      const buckets: TimeBucket[] = [];
      const current = new Date(range.start);

      while (current <= range.end) {
        const start = new Date(current);
        const end = new Date(current);
        end.setMinutes(59, 59, 999);
        buckets.push({
          key: `${start.getFullYear()}-${start.getMonth()}-${start.getDate()}-${start.getHours()}`,
          label: `${start.getHours().toString().padStart(2, '0')}:00`,
          start,
          end: end > range.end ? range.end : end,
        });
        current.setHours(current.getHours() + 1, 0, 0, 0);
      }

      return buckets;
    }

    return this.getDailyBuckets(range);
  }

  private getDailyBuckets(range: DateRange): TimeBucket[] {
    const buckets: TimeBucket[] = [];
    const current = new Date(range.start);

    while (current <= range.end) {
      const start = new Date(current);
      const end = new Date(current);
      end.setHours(23, 59, 59, 999);
      buckets.push({
        key: `${start.getFullYear()}-${start.getMonth()}-${start.getDate()}`,
        label: new Intl.DateTimeFormat('es-PE', {
          day: '2-digit',
          month: 'short',
        })
          .format(start)
          .replace('.', ''),
        start,
        end: end > range.end ? range.end : end,
      });
      current.setDate(current.getDate() + 1);
    }

    return buckets;
  }

  private aggregateSalesTrend(
    sales: Array<{ createdAt: Date; total: Prisma.Decimal }>,
    buckets: TimeBucket[],
  ) {
    const totals = new Map(
      buckets.map((bucket) => [bucket.key, new Prisma.Decimal(0)]),
    );

    for (const sale of sales) {
      const bucket = buckets.find(
        (item) => sale.createdAt >= item.start && sale.createdAt <= item.end,
      );
      if (!bucket) {
        continue;
      }
      totals.set(
        bucket.key,
        (totals.get(bucket.key) ?? new Prisma.Decimal(0)).add(sale.total),
      );
    }

    return buckets.map((bucket) => ({
      label: bucket.label,
      value: this.decimalToNumber(totals.get(bucket.key)),
    }));
  }

  private buildDailyEvolution(
    range: DateRange,
    completedSales: Array<{ createdAt: Date; total: Prisma.Decimal }>,
    annulledSales: Array<{
      anuladoAt: Date | null;
      total: Prisma.Decimal;
    }>,
  ) {
    const buckets = this.getDailyBuckets(range);

    return buckets.map((bucket) => {
      const completed = completedSales.filter(
        (sale) =>
          sale.createdAt >= bucket.start && sale.createdAt <= bucket.end,
      );
      const annulled = annulledSales.filter(
        (sale) =>
          sale.anuladoAt &&
          sale.anuladoAt >= bucket.start &&
          sale.anuladoAt <= bucket.end,
      );

      return {
        label: bucket.label,
        amount: this.decimalToString(
          completed.reduce(
            (sum, sale) => sum.add(sale.total),
            new Prisma.Decimal(0),
          ),
        ),
        sales: completed.length,
        cancellations: annulled.length,
        cancelledAmount: this.decimalToString(
          annulled.reduce(
            (sum, sale) => sum.add(sale.total),
            new Prisma.Decimal(0),
          ),
        ),
      };
    });
  }

  private buildVariantRanking(
    groups: Array<{
      productoVarianteId: bigint;
      _sum?: { cantidad?: number | null; total?: Prisma.Decimal | null };
    }>,
    variantMap: Map<
      string,
      {
        id: bigint;
        producto: { nombre: string; tipo: ProductoTipo };
        productoColor: { color: { nombre: string; hex: string } };
        talla: { nombre: string };
      }
    >,
  ) {
    return groups.map((group) => {
      const variant = variantMap.get(group.productoVarianteId.toString());
      return {
        variantId: group.productoVarianteId.toString(),
        name: variant
          ? variant.producto.tipo === ProductoTipo.normal
            ? variant.producto.nombre
            : `${variant.producto.nombre} - ${variant.productoColor.color.nombre} / ${variant.talla.nombre}`
          : `Variante ${group.productoVarianteId.toString()}`,
        productName: variant?.producto.nombre ?? null,
        colorName:
          variant?.producto.tipo === ProductoTipo.normal
            ? null
            : (variant?.productoColor.color.nombre ?? null),
        colorHex:
          variant?.producto.tipo === ProductoTipo.normal
            ? null
            : (variant?.productoColor.color.hex ?? null),
        sizeName:
          variant?.producto.tipo === ProductoTipo.normal
            ? null
            : (variant?.talla.nombre ?? null),
        units: group._sum?.cantidad ?? 0,
        amount: this.decimalToString(group._sum?.total),
      };
    });
  }

  private async buildSalesByBranch(
    empresaId: bigint,
    groups: Array<{
      sucursalId: bigint | null;
      _sum?: { total?: Prisma.Decimal | null };
    }>,
  ) {
    const branchIds = groups.flatMap((group) =>
      group.sucursalId ? [group.sucursalId] : [],
    );
    const branches = await this.prisma.sucursal.findMany({
      where: { empresaId, id: { in: branchIds } },
      select: { id: true, nombre: true },
    });
    const branchMap = new Map(
      branches.map((branch) => [branch.id.toString(), branch.nombre]),
    );

    return groups
      .map((group) => ({
        branchId: group.sucursalId?.toString() ?? null,
        name: group.sucursalId
          ? (branchMap.get(group.sucursalId.toString()) ?? 'Sucursal')
          : 'Sin sucursal',
        amount: this.decimalToString(group._sum?.total),
      }))
      .sort((a, b) => Number(b.amount) - Number(a.amount));
  }

  private toFilters(context: ReportContext) {
    return {
      sucursalId: context.sucursalId?.toString() ?? null,
      dateFilter: context.dateFilter,
      range: {
        start: context.range.start.toISOString(),
        end: context.range.end.toISOString(),
      },
    };
  }

  private decimalToString(value?: Prisma.Decimal | null) {
    return (value ?? new Prisma.Decimal(0)).toFixed(2);
  }

  private decimalToNumber(value?: Prisma.Decimal | null) {
    return Number(this.decimalToString(value));
  }
}
