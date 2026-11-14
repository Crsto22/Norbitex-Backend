import { Injectable, NotFoundException } from '@nestjs/common';
import ExcelJS from 'exceljs';
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
import { ResponseCacheService } from '../../common/cache/response-cache.service';
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

const MAX_EXPORT_SALES = 20_000;
const MAX_EXPORT_PRODUCTS = 100;
const MAX_EXPORT_CLIENTS = 100;

const comprobanteLabels: Record<string, string> = {
  nota_venta: 'Nota de venta',
  factura: 'Factura',
  boleta: 'Boleta',
  guia_remision: 'Guia de remision',
  nota_credito_factura: 'Nota de credito (factura)',
  nota_credito_boleta: 'Nota de credito (boleta)',
  nota_debito_factura: 'Nota de debito (factura)',
  nota_debito_boleta: 'Nota de debito (boleta)',
};

const sunatEstadoLabels: Record<string, string> = {
  no_aplica: 'No aplica',
  pendiente_envio: 'Pendiente de envio',
  enviando: 'Enviando',
  pendiente_cdr: 'Pendiente de CDR',
  aceptado: 'Aceptado',
  observado: 'Observado',
  rechazado: 'Rechazado',
  error_transitorio: 'Error transitorio',
  error_definitivo: 'Error definitivo',
};

const formaPagoLabels: Record<string, string> = {
  CONTADO: 'Contado',
  CREDITO: 'Credito',
};

const dateFilterFileLabels: Record<ReportDateFilter, string> = {
  today: 'hoy',
  '7days': '7dias',
  '14days': '14dias',
  '30days': '30dias',
};

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: ResponseCacheService,
  ) {}

  async findSales(
    empresaId: bigint,
    scope: CommercialScope,
    query: FindReportQueryDto,
  ) {
    return this.cache.getOrSet(
      this.cache.key('reports:sales', empresaId, scope, query),
      30_000,
      () => this.findSalesUncached(empresaId, scope, query),
    );
  }

  private async findSalesUncached(
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

  async exportSalesExcel(
    empresaId: bigint,
    scope: CommercialScope,
    query: FindReportQueryDto,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const context = await this.resolveContext(empresaId, scope, query, true);
    const baseWhere = this.buildSaleWhere(
      empresaId,
      context.sucursalId,
      context.creatorId,
    );

    const ventas = await this.prisma.venta.findMany({
      where: {
        ...baseWhere,
        estado: VentaEstado.completada,
        createdAt: { gte: context.range.start, lte: context.range.end },
      },
      orderBy: { createdAt: 'asc' },
      take: MAX_EXPORT_SALES + 1,
      select: {
        codigoInterno: true,
        correlativo: true,
        tipoComprobante: true,
        serie: true,
        numero: true,
        createdAt: true,
        moneda: true,
        formaPago: true,
        subtotal: true,
        descuentoMonto: true,
        igvMonto: true,
        total: true,
        sunatEstado: true,
        cliente: {
          select: {
            nombre: true,
            razonSocial: true,
            tipoDocumento: true,
            numeroDocumento: true,
          },
        },
        sucursal: { select: { nombre: true } },
        creadoPor: { select: { nombre: true, apellido: true } },
        detalles: {
          select: {
            descripcion: true,
            cantidad: true,
            precioUnitario: true,
            descuentoMonto: true,
            subtotal: true,
            total: true,
            productoVariante: {
              select: {
                sku: true,
                producto: { select: { nombre: true } },
                productoColor: {
                  select: { color: { select: { nombre: true } } },
                },
                talla: { select: { nombre: true } },
              },
            },
          },
        },
      },
    });

    const truncated = ventas.length > MAX_EXPORT_SALES;
    const rows = truncated ? ventas.slice(0, MAX_EXPORT_SALES) : ventas;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Nuvex';
    workbook.created = new Date();

    const salesSheet = workbook.addWorksheet('Ventas', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    salesSheet.columns = [
      { header: 'N° interno', key: 'codigoInterno', width: 14 },
      { header: 'Correlativo', key: 'correlativo', width: 16 },
      { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'Hora', key: 'hora', width: 8 },
      { header: 'Comprobante', key: 'comprobante', width: 20 },
      { header: 'Cliente', key: 'cliente', width: 32 },
      { header: 'Documento', key: 'documento', width: 16 },
      { header: 'Sucursal', key: 'sucursal', width: 22 },
      { header: 'Vendedor', key: 'vendedor', width: 24 },
      { header: 'Moneda', key: 'moneda', width: 8 },
      { header: 'Forma de pago', key: 'formaPago', width: 14 },
      { header: 'Subtotal', key: 'subtotal', width: 12 },
      { header: 'Descuento', key: 'descuento', width: 12 },
      { header: 'IGV', key: 'igv', width: 12 },
      { header: 'Total', key: 'total', width: 12 },
      { header: 'Estado SUNAT', key: 'sunatEstado', width: 18 },
    ];

    const productsSheet = workbook.addWorksheet('Productos vendidos', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    productsSheet.columns = [
      { header: 'Correlativo venta', key: 'correlativo', width: 16 },
      { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'Cliente', key: 'cliente', width: 32 },
      { header: 'Producto', key: 'producto', width: 32 },
      { header: 'Color', key: 'color', width: 14 },
      { header: 'Talla', key: 'talla', width: 10 },
      { header: 'SKU', key: 'sku', width: 18 },
      { header: 'Cantidad', key: 'cantidad', width: 10 },
      { header: 'Precio unitario', key: 'precioUnitario', width: 14 },
      { header: 'Descuento', key: 'descuento', width: 12 },
      { header: 'Subtotal', key: 'subtotal', width: 12 },
      { header: 'Total', key: 'total', width: 12 },
    ];

    for (const venta of rows) {
      const cliente =
        venta.cliente?.razonSocial?.trim() ||
        venta.cliente?.nombre?.trim() ||
        'Cliente generico';
      const documento = venta.cliente?.numeroDocumento
        ? `${(venta.cliente.tipoDocumento ?? '').toUpperCase()} ${venta.cliente.numeroDocumento}`.trim()
        : '';
      const vendedor = [venta.creadoPor?.nombre, venta.creadoPor?.apellido]
        .filter(Boolean)
        .join(' ');

      salesSheet.addRow({
        codigoInterno: venta.codigoInterno,
        correlativo: venta.correlativo,
        fecha: venta.createdAt,
        hora: this.formatTime(venta.createdAt),
        comprobante:
          comprobanteLabels[venta.tipoComprobante] ?? venta.tipoComprobante,
        cliente,
        documento,
        sucursal: venta.sucursal?.nombre ?? '',
        vendedor,
        moneda: venta.moneda,
        formaPago: formaPagoLabels[venta.formaPago] ?? venta.formaPago,
        subtotal: this.decimalToNumber(venta.subtotal),
        descuento: this.decimalToNumber(venta.descuentoMonto),
        igv: this.decimalToNumber(venta.igvMonto),
        total: this.decimalToNumber(venta.total),
        sunatEstado: sunatEstadoLabels[venta.sunatEstado] ?? venta.sunatEstado,
      });

      for (const detalle of venta.detalles) {
        productsSheet.addRow({
          correlativo: venta.correlativo,
          fecha: venta.createdAt,
          cliente,
          producto:
            detalle.productoVariante?.producto?.nombre ??
            detalle.descripcion ??
            'Producto',
          color: detalle.productoVariante?.productoColor?.color?.nombre ?? '',
          talla: detalle.productoVariante?.talla?.nombre ?? '',
          sku: detalle.productoVariante?.sku ?? '',
          cantidad: detalle.cantidad,
          precioUnitario: this.decimalToNumber(detalle.precioUnitario),
          descuento: this.decimalToNumber(detalle.descuentoMonto),
          subtotal: this.decimalToNumber(detalle.subtotal),
          total: this.decimalToNumber(detalle.total),
        });
      }
    }

    this.styleExcelSheet(
      salesSheet,
      ['subtotal', 'descuento', 'igv', 'total'],
      ['fecha'],
    );
    this.styleExcelSheet(
      productsSheet,
      ['precioUnitario', 'descuento', 'subtotal', 'total'],
      ['fecha'],
    );

    if (truncated) {
      const noteRow = salesSheet.addRow({
        codigoInterno: `Se muestran las primeras ${MAX_EXPORT_SALES.toLocaleString('es-PE')} ventas del periodo.`,
      });
      noteRow.font = { italic: true, color: { argb: 'FF6B7280' } };
    }

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const stamp = new Date().toISOString().slice(0, 10);

    return {
      buffer,
      fileName: `reporte-ventas-${dateFilterFileLabels[context.dateFilter]}-${stamp}.xlsx`,
    };
  }

  async exportProductsCsv(
    empresaId: bigint,
    scope: CommercialScope,
    query: FindReportQueryDto,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const context = await this.resolveContext(empresaId, scope, query);
    const completedWhere = {
      ...this.buildSaleWhere(empresaId, context.sucursalId, context.creatorId),
      estado: VentaEstado.completada,
      createdAt: { gte: context.range.start, lte: context.range.end },
    } satisfies Prisma.VentaWhereInput;

    const groups = await this.prisma.ventaDetalle.groupBy({
      by: ['productoVarianteId'],
      where: { venta: completedWhere },
      _sum: { cantidad: true, total: true },
      orderBy: [{ _sum: { cantidad: 'desc' } }, { _sum: { total: 'desc' } }],
      take: MAX_EXPORT_PRODUCTS,
    });

    const variantIds = groups.map((group) => group.productoVarianteId);
    const variants = variantIds.length
      ? await this.prisma.productoVariante.findMany({
          where: { empresaId, id: { in: variantIds } },
          select: {
            id: true,
            sku: true,
            codigoBarras: true,
            producto: {
              select: {
                nombre: true,
                categoria: { select: { nombre: true } },
              },
            },
          },
        })
      : [];
    const variantMap = new Map(
      variants.map((variant) => [variant.id.toString(), variant]),
    );

    const rows: string[][] = [
      [
        'Posicion',
        'SKU',
        'Producto',
        'Categoria',
        'Cantidad vendida',
        'Venta total',
        'Precio promedio',
      ],
    ];

    groups.forEach((group, index) => {
      const variant = variantMap.get(group.productoVarianteId.toString());
      const quantity = group._sum.cantidad ?? 0;
      const total = this.decimalToNumber(group._sum.total);
      const average = quantity > 0 ? total / quantity : 0;

      rows.push([
        String(index + 1),
        variant?.sku?.trim() || variant?.codigoBarras?.trim() || '',
        variant?.producto?.nombre ?? '',
        variant?.producto?.categoria?.nombre ?? 'Sin categoria',
        String(quantity),
        this.formatCsvNumber(total),
        this.formatCsvNumber(average),
      ]);
    });

    const stamp = new Date().toISOString().slice(0, 10);

    return {
      buffer: Buffer.from(this.buildCsv(rows), 'utf8'),
      fileName: `reporte-productos-${dateFilterFileLabels[context.dateFilter]}-${stamp}.csv`,
    };
  }

  async findProducts(
    empresaId: bigint,
    scope: CommercialScope,
    query: FindReportQueryDto,
  ) {
    return this.cache.getOrSet(
      this.cache.key('reports:products', empresaId, scope, query),
      30_000,
      () => this.findProductsUncached(empresaId, scope, query),
    );
  }

  private async findProductsUncached(
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

  async exportClientsCsv(
    empresaId: bigint,
    scope: CommercialScope,
    query: FindReportQueryDto,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const context = await this.resolveContext(empresaId, scope, query, true);
    const completedWhere = {
      ...this.buildSaleWhere(empresaId, context.sucursalId, context.creatorId),
      estado: VentaEstado.completada,
      createdAt: { gte: context.range.start, lte: context.range.end },
      clienteId: { not: null },
    } satisfies Prisma.VentaWhereInput;

    const groups = await this.prisma.venta.groupBy({
      by: ['clienteId'],
      where: completedWhere,
      _count: { _all: true },
      _sum: { total: true },
      orderBy: [{ _count: { clienteId: 'desc' } }, { _sum: { total: 'desc' } }],
      take: MAX_EXPORT_CLIENTS,
    });

    const clientIds = groups.flatMap((group) =>
      group.clienteId ? [group.clienteId] : [],
    );
    const clients = clientIds.length
      ? await this.prisma.cliente.findMany({
          where: { empresaId, id: { in: clientIds } },
          select: {
            id: true,
            tipoDocumento: true,
            numeroDocumento: true,
            nombre: true,
            razonSocial: true,
          },
        })
      : [];
    const clientMap = new Map(
      clients.map((client) => [client.id.toString(), client]),
    );

    const rows: string[][] = [
      [
        'Posicion',
        'Cliente',
        'Documento',
        'Compras',
        'Venta total',
        'Ticket promedio',
      ],
    ];

    groups.forEach((group, index) => {
      if (!group.clienteId) return;

      const client = clientMap.get(group.clienteId.toString());
      const purchases = group._count._all;
      const total = this.decimalToNumber(group._sum.total);
      const average = purchases > 0 ? total / purchases : 0;

      rows.push([
        String(index + 1),
        client?.razonSocial?.trim() ||
          client?.nombre?.trim() ||
          client?.numeroDocumento?.trim() ||
          'Cliente',
        client?.numeroDocumento
          ? `${(client.tipoDocumento ?? '').toUpperCase()} ${client.numeroDocumento}`.trim()
          : '',
        String(purchases),
        this.formatCsvNumber(total),
        this.formatCsvNumber(average),
      ]);
    });

    const stamp = new Date().toISOString().slice(0, 10);

    return {
      buffer: Buffer.from(this.buildCsv(rows), 'utf8'),
      fileName: `reporte-clientes-${dateFilterFileLabels[context.dateFilter]}-${stamp}.csv`,
    };
  }

  async findClients(
    empresaId: bigint,
    scope: CommercialScope,
    query: FindReportQueryDto,
  ) {
    return this.cache.getOrSet(
      this.cache.key('reports:clients', empresaId, scope, query),
      30_000,
      () => this.findClientsUncached(empresaId, scope, query),
    );
  }

  private async findClientsUncached(
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

  async exportUsersCsv(
    empresaId: bigint,
    scope: CommercialScope,
    query: FindReportQueryDto,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const context = await this.resolveContext(empresaId, scope, query, true);
    const baseWhere = this.buildSaleWhere(
      empresaId,
      context.sucursalId,
      context.creatorId,
    );
    const completedWhere = {
      ...baseWhere,
      estado: VentaEstado.completada,
      createdAt: { gte: context.range.start, lte: context.range.end },
    } satisfies Prisma.VentaWhereInput;
    const annulledWhere = {
      ...baseWhere,
      estado: VentaEstado.anulada,
      anuladoAt: { gte: context.range.start, lte: context.range.end },
    } satisfies Prisma.VentaWhereInput;

    const [companyUsers, salesGroups, cancellationGroups] = await Promise.all([
      this.prisma.empresaUsuario.findMany({
        where: {
          empresaId,
          ...(context.creatorId ? { usuarioId: context.creatorId } : {}),
          estado: EmpresaUsuarioEstado.activo,
          usuario: { estado: UsuarioEstado.activo },
        },
        select: {
          id: true,
          usuarioId: true,
          usuario: { select: { nombre: true, apellido: true } },
        },
        orderBy: { usuario: { nombre: 'asc' } },
      }),
      this.prisma.venta.groupBy({
        by: ['creadoPorId'],
        where: { ...completedWhere, creadoPorId: { not: null } },
        _count: { _all: true },
        _sum: { total: true },
        _avg: { total: true },
      }),
      this.prisma.venta.groupBy({
        by: ['creadoPorId'],
        where: { ...annulledWhere, creadoPorId: { not: null } },
        _count: { _all: true },
        _sum: { total: true },
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

    const rows: string[][] = [
      [
        'Posicion',
        'Usuario',
        'Ventas',
        'Monto vendido',
        'Ticket promedio',
        'Anuladas',
        'Monto anulado',
      ],
    ];

    const ranking = companyUsers
      .map((companyUser) => {
        const userId = companyUser.usuarioId.toString();
        const sales = salesMap.get(userId);
        const cancellations = cancellationsMap.get(userId);

        return {
          name:
            [companyUser.usuario.nombre, companyUser.usuario.apellido]
              .filter(Boolean)
              .join(' ') || 'Usuario',
          sales: sales?._count._all ?? 0,
          amount: this.decimalToNumber(sales?._sum.total),
          averageTicket: this.decimalToNumber(sales?._avg.total),
          cancellations: cancellations?._count._all ?? 0,
          cancelledAmount: this.decimalToNumber(cancellations?._sum.total),
        };
      })
      .sort(
        (a, b) =>
          b.amount - a.amount ||
          b.sales - a.sales ||
          a.name.localeCompare(b.name),
      );

    ranking.forEach((user, index) => {
      rows.push([
        String(index + 1),
        user.name,
        String(user.sales),
        this.formatCsvNumber(user.amount),
        this.formatCsvNumber(user.averageTicket),
        String(user.cancellations),
        this.formatCsvNumber(user.cancelledAmount),
      ]);
    });

    const stamp = new Date().toISOString().slice(0, 10);

    return {
      buffer: Buffer.from(this.buildCsv(rows), 'utf8'),
      fileName: `reporte-usuarios-${dateFilterFileLabels[context.dateFilter]}-${stamp}.csv`,
    };
  }

  async findUsers(
    empresaId: bigint,
    scope: CommercialScope,
    query: FindReportQueryDto,
  ) {
    return this.cache.getOrSet(
      this.cache.key('reports:users', empresaId, scope, query),
      30_000,
      () => this.findUsersUncached(empresaId, scope, query),
    );
  }

  private async findUsersUncached(
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

  private formatTime(date: Date) {
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');

    return `${hours}:${minutes}`;
  }

  private formatCsvNumber(value: number) {
    return value.toFixed(2).replace('.', ',');
  }

  private buildCsv(rows: string[][]) {
    const content = rows
      .map((row) => row.map((cell) => this.csvCell(cell)).join(';'))
      .join('\r\n');

    return `\uFEFF${content}\r\n`;
  }

  private csvCell(value: string) {
    if (/[";\r\n]/.test(value)) {
      return `"${value.replace(/"/g, '""')}"`;
    }

    return value;
  }

  private styleExcelSheet(
    sheet: ExcelJS.Worksheet,
    moneyColumns: string[],
    dateColumns: string[],
  ) {
    const header = sheet.getRow(1);
    header.height = 22;
    header.alignment = { vertical: 'middle', horizontal: 'left' };
    header.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF101D69' },
      };
    });

    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: sheet.columnCount },
    };

    for (const key of moneyColumns) {
      sheet.getColumn(key).numFmt = '#,##0.00';
    }

    for (const key of dateColumns) {
      sheet.getColumn(key).numFmt = 'dd/mm/yyyy';
    }
  }
}
