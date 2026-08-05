import { Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  ProductoTipo,
  SucursalTipo,
  VentaEstado,
  VentaPagoEstado,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  resolveScopedBranchId,
  scopedCreatorId,
  type CommercialScope,
} from '../../common/commercial-access';
import {
  DashboardDateFilter,
  FindDashboardQueryDto,
} from './dto/find-dashboard-query.dto';

const paymentColors = ['#7c3aed', '#10b981', '#3b82f6', '#f97316', '#ef4444'];
type TrendBucket = {
  key: string;
  label: string;
  start: Date;
  end: Date;
};

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async find(
    empresaId: bigint,
    scope: CommercialScope,
    query: FindDashboardQueryDto,
  ) {
    const sucursalId = resolveScopedBranchId(scope, query.sucursalId);
    await this.validateSucursalId(empresaId, sucursalId);
    const saleWhere = this.buildSaleWhere(
      empresaId,
      sucursalId,
      scopedCreatorId(scope),
    );
    const completedWhere = {
      ...saleWhere,
      estado: VentaEstado.completada,
    } satisfies Prisma.VentaWhereInput;
    const annulledWhere = {
      ...saleWhere,
      estado: VentaEstado.anulada,
    } satisfies Prisma.VentaWhereInput;
    const selectedRange = this.getDateFilterRange(query.dateFilter ?? 'today');
    const selectedCompletedWhere = {
      ...completedWhere,
      createdAt: { gte: selectedRange.start, lte: selectedRange.end },
    } satisfies Prisma.VentaWhereInput;
    const selectedAnnulledWhere = {
      ...annulledWhere,
      createdAt: { gte: selectedRange.start, lte: selectedRange.end },
    } satisfies Prisma.VentaWhereInput;
    const monthRange = this.getCurrentMonthRange();
    const todayRange = this.getDateFilterRange('today');
    const trendRange = this.getTrendRange(query.dateFilter ?? 'today');

    const [
      completedAggregate,
      periodAggregate,
      todayAggregate,
      annulledAggregate,
      emittedCount,
      voidedCount,
      unitsAggregate,
      variantsSold,
      monthlySales,
      topVariantGroups,
      paymentGroups,
    ] = await this.prisma.$transaction([
      this.prisma.venta.aggregate({
        where: selectedCompletedWhere,
        _sum: { total: true },
        _avg: { total: true },
      }),
      this.prisma.venta.aggregate({
        where: {
          ...completedWhere,
          createdAt: { gte: monthRange.start, lte: monthRange.end },
        },
        _sum: { total: true },
      }),
      this.prisma.venta.aggregate({
        where: {
          ...completedWhere,
          createdAt: { gte: todayRange.start, lte: todayRange.end },
        },
        _sum: { total: true },
      }),
      this.prisma.venta.aggregate({
        where: selectedAnnulledWhere,
        _sum: { total: true },
      }),
      this.prisma.venta.count({ where: selectedCompletedWhere }),
      this.prisma.venta.count({ where: selectedAnnulledWhere }),
      this.prisma.ventaDetalle.aggregate({
        where: { venta: selectedCompletedWhere },
        _sum: { cantidad: true },
      }),
      this.prisma.ventaDetalle.findMany({
        where: { venta: selectedCompletedWhere },
        distinct: ['productoVarianteId'],
        select: { productoVarianteId: true },
      }),
      this.prisma.venta.findMany({
        where: {
          ...completedWhere,
          createdAt: { gte: trendRange.start, lte: trendRange.end },
        },
        select: { createdAt: true, total: true },
      }),
      this.prisma.ventaDetalle.groupBy({
        by: ['productoVarianteId'],
        where: { venta: selectedCompletedWhere },
        _sum: { cantidad: true, total: true },
        orderBy: { _sum: { cantidad: 'desc' } },
        take: 5,
      }),
      this.prisma.ventaPago.groupBy({
        by: ['metodoPagoId'],
        where: {
          estado: VentaPagoEstado.activo,
          venta: selectedCompletedWhere,
        },
        _sum: { monto: true },
        orderBy: { _sum: { monto: 'desc' } },
      }),
    ]);

    const [documentTypeGroups, branchGroups] = await Promise.all([
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

    const topVariants = await this.buildTopVariants(topVariantGroups);
    const paymentMethods = await this.buildPaymentMethods(
      empresaId,
      paymentGroups,
    );
    const salesByBranch = await this.buildSalesByBranch(
      empresaId,
      branchGroups,
    );

    return {
      filters: {
        sucursalId: sucursalId?.toString() ?? null,
        dateFilter: query.dateFilter ?? 'today',
        range: {
          start: selectedRange.start.toISOString(),
          end: selectedRange.end.toISOString(),
        },
      },
      summary: {
        todaySalesTotal: this.decimalToString(todayAggregate._sum.total),
        salesFilterTotal: this.decimalToString(completedAggregate._sum.total),
        periodSalesTotal: this.decimalToString(periodAggregate._sum.total),
        averageTicket: this.decimalToString(completedAggregate._avg.total),
        unitsSold: unitsAggregate._sum.cantidad ?? 0,
        variantsSold: variantsSold.length,
        annulledAmount: this.decimalToString(annulledAggregate._sum.total),
        emittedCount,
        voidedCount,
      },
      salesTrend: {
        granularity: trendRange.granularity,
        data: this.buildSalesTrend(monthlySales, trendRange.buckets),
      },
      salesByDocumentType: documentTypeGroups
        .map((group) => ({
          type: group.tipoComprobante,
          count: group._count._all,
          amount: this.decimalToString(group._sum.total),
        }))
        .sort((a, b) => b.count - a.count),
      salesByBranch,
      topVariants,
      paymentMethods,
    };
  }

  private async validateSucursalId(empresaId: bigint, id: bigint | null) {
    if (!id) return;
    const sucursal = await this.prisma.sucursal.findFirst({
      where: { id, empresaId, tipo: SucursalTipo.tienda },
      select: { id: true },
    });

    if (!sucursal) {
      throw new NotFoundException('Sucursal no encontrada');
    }
  }

  private buildSaleWhere(
    empresaId: bigint,
    sucursalId: bigint | null,
    userId: bigint | null,
  ) {
    return {
      empresaId,
      ...(sucursalId ? { sucursalId } : {}),
      ...(userId ? { creadoPorId: userId } : {}),
    } satisfies Prisma.VentaWhereInput;
  }

  private getCurrentMonthRange() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
      23,
      59,
      59,
      999,
    );

    return { start, end };
  }

  private getDateFilterRange(filter: DashboardDateFilter) {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);

    if (filter !== 'today') {
      const days = filter === '7days' ? 7 : filter === '14days' ? 14 : 30;
      start.setDate(start.getDate() - (days - 1));
    }

    return { start, end: now };
  }

  private getTrendRange(filter: DashboardDateFilter) {
    if (filter === 'today') {
      const { start, end } = this.getDateFilterRange(filter);
      const buckets: TrendBucket[] = [];
      const current = new Date(start);

      while (current <= end) {
        const bucketStart = new Date(current);
        const bucketEnd = new Date(current);
        bucketEnd.setMinutes(59, 59, 999);
        buckets.push({
          key: `${bucketStart.getFullYear()}-${bucketStart.getMonth()}-${bucketStart.getDate()}-${bucketStart.getHours()}`,
          label: `${bucketStart.getHours().toString().padStart(2, '0')}:00`,
          start: bucketStart,
          end: bucketEnd > end ? end : bucketEnd,
        });
        current.setHours(current.getHours() + 1, 0, 0, 0);
      }

      return { start, end, buckets, granularity: 'hour' as const };
    }

    const { start, end } = this.getDateFilterRange(filter);
    const buckets: TrendBucket[] = [];
    const current = new Date(start);

    while (current <= end) {
      const bucketStart = new Date(current);
      const bucketEnd = new Date(current);
      bucketEnd.setHours(23, 59, 59, 999);
      buckets.push({
        key: `${bucketStart.getFullYear()}-${bucketStart.getMonth()}-${bucketStart.getDate()}`,
        label: new Intl.DateTimeFormat('es-PE', {
          day: '2-digit',
          month: 'short',
        })
          .format(bucketStart)
          .replace('.', ''),
        start: bucketStart,
        end: bucketEnd > end ? end : bucketEnd,
      });
      current.setDate(current.getDate() + 1);
    }

    return { start, end, buckets, granularity: 'day' as const };
  }

  private buildSalesTrend(
    sales: Array<{ createdAt: Date; total: Prisma.Decimal }>,
    buckets: TrendBucket[],
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
      const current = totals.get(bucket.key) ?? new Prisma.Decimal(0);
      totals.set(bucket.key, current.add(sale.total));
    }

    return buckets.map((bucket) => ({
      label: bucket.label,
      value: this.decimalToNumber(totals.get(bucket.key)),
    }));
  }

  private async buildTopVariants(
    groups: Array<{
      productoVarianteId: bigint;
      _sum?: { cantidad?: number | null; total?: Prisma.Decimal | null };
    }>,
  ) {
    const variantIds = groups.map((group) => group.productoVarianteId);
    const variants = await this.prisma.productoVariante.findMany({
      where: { id: { in: variantIds } },
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

    return groups.map((group) => {
      const variant = variantMap.get(group.productoVarianteId.toString());
      return {
        productoVarianteId: group.productoVarianteId.toString(),
        name: variant
          ? variant.producto.tipo === ProductoTipo.normal
            ? variant.producto.nombre
            : `${variant.producto.nombre} - ${variant.talla.nombre}`
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
        total: this.decimalToString(group._sum?.total),
      };
    });
  }

  private async buildPaymentMethods(
    empresaId: bigint,
    groups: Array<{
      metodoPagoId: bigint;
      _sum?: { monto?: Prisma.Decimal | null };
    }>,
  ) {
    const methodIds = groups.map((group) => group.metodoPagoId);
    const methods = await this.prisma.metodoPago.findMany({
      where: { empresaId, id: { in: methodIds } },
      select: { id: true, nombre: true, nombreKey: true },
    });
    const methodMap = new Map(
      methods.map((method) => [method.id.toString(), method]),
    );
    const total = groups.reduce(
      (sum, group) => sum.add(group._sum?.monto ?? new Prisma.Decimal(0)),
      new Prisma.Decimal(0),
    );

    return groups
      .sort(
        (a, b) =>
          this.decimalToNumber(b._sum?.monto) -
          this.decimalToNumber(a._sum?.monto),
      )
      .map((group, index) => {
        const amount = group._sum?.monto ?? new Prisma.Decimal(0);
        const method = methodMap.get(group.metodoPagoId.toString());
        const percentage = total.equals(0)
          ? 0
          : Number(amount.mul(100).div(total).toFixed(2));

        return {
          metodoPagoId: group.metodoPagoId.toString(),
          name: method?.nombre ?? 'Metodo de pago',
          key: method?.nombreKey ?? null,
          amount: this.decimalToString(amount),
          percentage,
          color: paymentColors[index % paymentColors.length],
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
        sucursalId: group.sucursalId?.toString() ?? null,
        name: group.sucursalId
          ? (branchMap.get(group.sucursalId.toString()) ?? 'Sucursal')
          : 'Sin sucursal',
        amount: this.decimalToString(group._sum?.total),
      }))
      .sort((a, b) => Number(b.amount) - Number(a.amount));
  }

  private decimalToString(value?: Prisma.Decimal | null) {
    return (value ?? new Prisma.Decimal(0)).toFixed(2);
  }

  private decimalToNumber(value?: Prisma.Decimal | null) {
    return Number(this.decimalToString(value));
  }
}
