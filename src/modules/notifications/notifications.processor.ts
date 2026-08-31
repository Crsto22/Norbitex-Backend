import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  EmpresaEstado,
  LiquidacionExcedenteEstado,
  NotificacionCategoria,
  NotificacionNivel,
  PagoSuscripcionEstado,
  PlataformaComprobanteEstado,
  ProductoTipo,
  SunatEstado,
  VentaTipoComprobante,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PlansService } from '../plans/plans.service';
import { NotificationsService } from './notifications.service';

@Injectable()
export class NotificationsProcessor implements OnModuleInit {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlansService,
    private readonly notifications: NotificationsService,
  ) {}

  async onModuleInit() {
    await this.safeRun('stock inicial', () => this.processStock());
    await this.safeRun('eventos recientes', () => this.processRecentEvents());
  }

  @Cron('0 */5 * * * *')
  async processRecentEvents() {
    const since = new Date(Date.now() - 10 * 60_000);
    await this.processCompanies(since);
    await this.processElectronicSales(since);
    await this.processCreditNotes(since);
    await this.processPlatformReceipts(since);
    await this.processSubscriptionSales(since);
    await this.processOverageLiquidations(since);
    await this.processStock(since);
  }

  @Cron('0 5 * * * *')
  async processCommercialAlerts() {
    const superAdmins = await this.notifications.getSuperAdminIds();
    let cursor: bigint | undefined;
    while (true) {
      const companies = await this.prisma.empresa.findMany({
        where: { estado: EmpresaEstado.activa },
        select: {
          id: true,
          nombreComercial: true,
          planCodigo: true,
          planFinAt: true,
        },
        orderBy: { id: 'asc' },
        take: 100,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const company of companies) {
        await this.safeRun(
          `alertas empresa ${company.id.toString()}`,
          async () => {
            const owners = await this.notifications.getOwnerIds(company.id);
            const current = await this.plans.getCurrent(company.id);
            const endKey = company.planFinAt?.toISOString() ?? 'sin-fecha';
            if (current.status === 'expired') {
              await this.notifications.createAutomatic({
                eventKey: `plan-expired:owner:${company.id.toString()}:${endKey}`,
                category: NotificacionCategoria.plan,
                level: NotificacionNivel.error,
                title: 'Tu plan ha vencido',
                message:
                  'Renueva el plan para continuar usando los modulos operativos.',
                link: '/configuracion/plan',
                companyId: company.id,
                recipientIds: owners,
              });
              await this.notifications.createAutomatic({
                eventKey: `plan-expired:admin:${company.id.toString()}:${endKey}`,
                category: NotificacionCategoria.plan,
                level: NotificacionNivel.error,
                title: 'Plan vencido',
                message: `${company.nombreComercial} tiene el plan vencido.`,
                link: `/superadmin/suscripciones/${company.id.toString()}`,
                companyId: company.id,
                recipientIds: superAdmins,
              });
              return;
            }

            if ([7, 3, 1].includes(current.daysRemaining ?? -1)) {
              const days = current.daysRemaining!;
              await this.notifications.createAutomatic({
                eventKey: `plan-expiring:owner:${company.id.toString()}:${endKey}:${days}`,
                category: NotificacionCategoria.plan,
                level: NotificacionNivel.advertencia,
                title: 'Tu plan esta por vencer',
                message: `Quedan ${days} dia${days === 1 ? '' : 's'} de vigencia.`,
                link: '/configuracion/plan',
                companyId: company.id,
                recipientIds: owners,
              });
              await this.notifications.createAutomatic({
                eventKey: `plan-expiring:admin:${company.id.toString()}:${endKey}:${days}`,
                category: NotificacionCategoria.plan,
                level: NotificacionNivel.advertencia,
                title: 'Plan proximo a vencer',
                message: `${company.nombreComercial} vence en ${days} dia${days === 1 ? '' : 's'}.`,
                link: `/superadmin/suscripciones/${company.id.toString()}`,
                companyId: company.id,
                recipientIds: superAdmins,
              });
            }

            await this.processLimits(company, current, owners);
          },
        );
      }
      if (companies.length < 100) break;
      cursor = companies.at(-1)!.id;
    }
  }

  private async processLimits(
    company: { id: bigint; planCodigo: string },
    current: Awaited<ReturnType<PlansService['getCurrent']>>,
    owners: bigint[],
  ) {
    const labels: Record<string, string> = {
      users: 'usuarios',
      branches: 'sucursales',
      warehouses: 'almacenes',
      products: 'productos',
      variants: 'variantes',
      documents: 'comprobantes',
      documentQueries: 'consultas DNI/RUC',
      storageBytes: 'almacenamiento',
    };
    const period = this.limaPeriod(new Date());
    for (const resource of Object.keys(current.usage) as Array<
      keyof typeof current.usage
    >) {
      const used = current.usage[resource] ?? 0;
      const limit = current.effectiveLimits[resource];
      if (limit === null) continue;
      if (used === 0 || (limit > 0 && used < limit * 0.8)) continue;
      const milestone = limit === 0 || used >= limit ? 100 : 80;
      const scope =
        resource === 'documents' || resource === 'documentQueries'
          ? period
          : company.planCodigo;
      await this.notifications.createAutomatic({
        eventKey: `limit:${company.id.toString()}:${resource}:${scope}:${limit}:${milestone}`,
        category: NotificacionCategoria.limite,
        level:
          milestone === 100
            ? NotificacionNivel.error
            : NotificacionNivel.advertencia,
        title: `Limite de ${labels[resource]}`,
        message: `Usaste ${used} de ${limit} disponibles en tu plan.`,
        link: '/configuracion/plan',
        companyId: company.id,
        recipientIds: owners,
      });
    }

    if (current.documentOverage.count > 0) {
      await this.notifications.createAutomatic({
        eventKey: `overage:${company.id.toString()}:${period}`,
        category: NotificacionCategoria.facturacion,
        level: NotificacionNivel.advertencia,
        title: 'Comprobantes adicionales',
        message: `Tienes ${current.documentOverage.count} comprobante(s) adicional(es), por S/ ${current.documentOverage.estimatedAmount}.`,
        link: '/configuracion/plan',
        companyId: company.id,
        recipientIds: owners,
      });
    }
  }

  private async processCompanies(since: Date) {
    const [companies, recipients] = await Promise.all([
      this.prisma.empresa.findMany({
        where: { createdAt: { gte: since } },
        select: { id: true, nombreComercial: true, createdAt: true },
      }),
      this.notifications.getSuperAdminIds(),
    ]);
    for (const company of companies) {
      await this.notifications.createAutomatic({
        eventKey: `company-created:${company.id.toString()}`,
        category: NotificacionCategoria.empresa,
        level: NotificacionNivel.exito,
        title: 'Nueva empresa registrada',
        message: `${company.nombreComercial} acaba de registrarse en Nuvex.`,
        link: '/superadmin/empresas',
        companyId: company.id,
        recipientIds: recipients,
      });
    }
  }

  private async processElectronicSales(since: Date) {
    const sales = await this.prisma.venta.findMany({
      where: {
        updatedAt: { gte: since },
        tipoComprobante: {
          in: [VentaTipoComprobante.boleta, VentaTipoComprobante.factura],
        },
        sunatEstado: {
          in: [
            SunatEstado.aceptado,
            SunatEstado.observado,
            SunatEstado.rechazado,
            SunatEstado.error_definitivo,
          ],
        },
      },
      select: {
        id: true,
        publicId: true,
        empresaId: true,
        creadoPorId: true,
        correlativo: true,
        sunatEstado: true,
      },
    });
    for (const sale of sales) {
      const recipients = await this.notifications.getOperationalRecipientIds(
        sale.empresaId,
        ['comprobantes', 'historial-ventas'],
        sale.creadoPorId,
      );
      await this.notifications.createAutomatic({
        eventKey: `sunat-sale:${sale.id.toString()}:${sale.sunatEstado}`,
        category: NotificacionCategoria.sunat,
        level: this.sunatLevel(sale.sunatEstado),
        title: this.sunatTitle(sale.sunatEstado),
        message: `${sale.correlativo}: ${this.sunatMessage(sale.sunatEstado)}.`,
        link: `/historial/ventas/${sale.publicId}`,
        companyId: sale.empresaId,
        recipientIds: recipients,
      });
    }
  }

  private async processCreditNotes(since: Date) {
    const notes = await this.prisma.notaCredito.findMany({
      where: {
        updatedAt: { gte: since },
        sunatEstado: {
          in: [
            SunatEstado.aceptado,
            SunatEstado.observado,
            SunatEstado.rechazado,
            SunatEstado.error_definitivo,
          ],
        },
      },
      select: {
        id: true,
        empresaId: true,
        creadoPorId: true,
        correlativo: true,
        sunatEstado: true,
      },
    });
    for (const note of notes) {
      const recipients = await this.notifications.getOperationalRecipientIds(
        note.empresaId,
        ['comprobantes', 'nota-credito'],
        note.creadoPorId,
      );
      await this.notifications.createAutomatic({
        eventKey: `sunat-credit-note:${note.id.toString()}:${note.sunatEstado}`,
        category: NotificacionCategoria.sunat,
        level: this.sunatLevel(note.sunatEstado),
        title: this.sunatTitle(note.sunatEstado),
        message: `${note.correlativo}: ${this.sunatMessage(note.sunatEstado)}.`,
        link: '/facturacion/nota-credito',
        companyId: note.empresaId,
        recipientIds: recipients,
      });
    }
  }

  private async processStock(since?: Date) {
    const rows = await this.prisma.inventarioSucursal.findMany({
      where: {
        stockActual: { lte: 3 },
        ...(since ? { updatedAt: { gte: since } } : {}),
        productoVariante: { deletedAt: null, activo: true },
      },
      select: {
        id: true,
        empresaId: true,
        stockActual: true,
        updatedAt: true,
        sucursal: { select: { nombre: true } },
        productoVariante: {
          select: {
            sku: true,
            producto: { select: { nombre: true, tipo: true } },
            productoColor: { select: { color: { select: { nombre: true } } } },
            talla: { select: { nombre: true } },
          },
        },
      },
    });
    for (const row of rows) {
      const recipients = await this.notifications.getOperationalRecipientIds(
        row.empresaId,
        ['productos', 'ventas-pos'],
      );
      const variant = row.productoVariante;
      const detail =
        variant.producto.tipo === ProductoTipo.normal
          ? ''
          : ` (${variant.productoColor.color.nombre} / ${variant.talla.nombre})`;
      await this.notifications.createAutomatic({
        eventKey: `stock:${row.id.toString()}:${row.updatedAt.toISOString()}:${row.stockActual}`,
        category: NotificacionCategoria.stock,
        level:
          row.stockActual === 0
            ? NotificacionNivel.error
            : NotificacionNivel.advertencia,
        title:
          row.stockActual === 0 ? 'Producto sin stock' : 'Stock por agotarse',
        message: `${variant.producto.nombre}${detail} tiene ${row.stockActual} unidad(es) en ${row.sucursal.nombre}.`,
        link: '/catalogo/productos',
        companyId: row.empresaId,
        recipientIds: recipients,
      });
    }
  }

  private async processPlatformReceipts(since: Date) {
    const receipts = await this.prisma.comprobantePlataforma.findMany({
      where: {
        updatedAt: { gte: since },
        estado: {
          in: [
            PlataformaComprobanteEstado.aceptado,
            PlataformaComprobanteEstado.rechazado,
            PlataformaComprobanteEstado.error,
          ],
        },
      },
      select: {
        id: true,
        empresaId: true,
        serie: true,
        numero: true,
        estado: true,
        empresa: { select: { nombreComercial: true } },
      },
    });
    const admins = await this.notifications.getSuperAdminIds();
    for (const receipt of receipts) {
      const owners = await this.notifications.getOwnerIds(receipt.empresaId);
      const correlativo = `${receipt.serie}-${String(receipt.numero).padStart(8, '0')}`;
      const level =
        receipt.estado === PlataformaComprobanteEstado.aceptado
          ? NotificacionNivel.exito
          : NotificacionNivel.error;
      await this.notifications.createAutomatic({
        eventKey: `platform-receipt:owner:${receipt.id.toString()}:${receipt.estado}`,
        category: NotificacionCategoria.facturacion,
        level,
        title: 'Comprobante de Nuvex actualizado',
        message: `${correlativo} se encuentra ${receipt.estado}.`,
        link: '/configuracion/plan',
        companyId: receipt.empresaId,
        recipientIds: owners,
      });
      await this.notifications.createAutomatic({
        eventKey: `platform-receipt:admin:${receipt.id.toString()}:${receipt.estado}`,
        category: NotificacionCategoria.facturacion,
        level,
        title: 'Estado de comprobante actualizado',
        message: `${correlativo} de ${receipt.empresa.nombreComercial}: ${receipt.estado}.`,
        link: '/superadmin/facturacion/comprobantes',
        companyId: receipt.empresaId,
        recipientIds: admins,
      });
    }
  }

  private async processSubscriptionSales(since: Date) {
    const sales = await this.prisma.pagoSuscripcion.findMany({
      where: {
        createdAt: { gte: since },
        estado: PagoSuscripcionEstado.pagado,
      },
      select: {
        id: true,
        empresaId: true,
        planCodigo: true,
        meses: true,
        empresa: { select: { nombreComercial: true } },
      },
    });
    const admins = await this.notifications.getSuperAdminIds();
    for (const sale of sales) {
      const owners = await this.notifications.getOwnerIds(sale.empresaId);
      const planName = this.plans.getDefinition(sale.planCodigo).name;
      await this.notifications.createAutomatic({
        eventKey: `subscription-sale:owner:${sale.id.toString()}`,
        category: NotificacionCategoria.plan,
        level: NotificacionNivel.exito,
        title: 'Plan activado',
        message: `Tu plan ${planName} fue activado por ${sale.meses} mes(es).`,
        link: '/configuracion/plan',
        companyId: sale.empresaId,
        recipientIds: owners,
      });
      await this.notifications.createAutomatic({
        eventKey: `subscription-sale:admin:${sale.id.toString()}`,
        category: NotificacionCategoria.facturacion,
        level: NotificacionNivel.exito,
        title: 'Nueva venta de plan',
        message: `${sale.empresa.nombreComercial} adquirio el plan ${planName}.`,
        link: '/superadmin/suscripciones',
        companyId: sale.empresaId,
        recipientIds: admins,
      });
    }
  }

  private async processOverageLiquidations(since: Date) {
    const rows = await this.prisma.liquidacionExcedente.findMany({
      where: {
        updatedAt: { gte: since },
        estado: {
          in: [
            LiquidacionExcedenteEstado.pendiente,
            LiquidacionExcedenteEstado.pagado,
          ],
        },
      },
      select: {
        id: true,
        empresaId: true,
        periodo: true,
        montoTotal: true,
        estado: true,
        empresa: { select: { nombreComercial: true } },
      },
    });
    const admins = await this.notifications.getSuperAdminIds();
    for (const row of rows) {
      const owners = await this.notifications.getOwnerIds(row.empresaId);
      const paid = row.estado === LiquidacionExcedenteEstado.pagado;
      await this.notifications.createAutomatic({
        eventKey: `overage-liquidation:owner:${row.id.toString()}:${row.estado}`,
        category: NotificacionCategoria.facturacion,
        level: paid ? NotificacionNivel.exito : NotificacionNivel.advertencia,
        title: paid ? 'Excedentes pagados' : 'Liquidacion de excedentes',
        message: `Periodo ${row.periodo}: S/ ${row.montoTotal.toFixed(2)} ${paid ? 'pagado' : 'pendiente'}.`,
        link: '/configuracion/plan',
        companyId: row.empresaId,
        recipientIds: owners,
      });
      await this.notifications.createAutomatic({
        eventKey: `overage-liquidation:admin:${row.id.toString()}:${row.estado}`,
        category: NotificacionCategoria.facturacion,
        level: paid ? NotificacionNivel.exito : NotificacionNivel.advertencia,
        title: paid ? 'Liquidacion pagada' : 'Liquidacion pendiente',
        message: `${row.empresa.nombreComercial}: S/ ${row.montoTotal.toFixed(2)} del periodo ${row.periodo}.`,
        link: '/superadmin/suscripciones',
        companyId: row.empresaId,
        recipientIds: admins,
      });
    }
  }

  private sunatLevel(status: SunatEstado) {
    if (status === SunatEstado.aceptado) return NotificacionNivel.exito;
    if (status === SunatEstado.observado) return NotificacionNivel.advertencia;
    return NotificacionNivel.error;
  }

  private sunatTitle(status: SunatEstado) {
    if (status === SunatEstado.aceptado)
      return 'Comprobante aceptado por SUNAT';
    if (status === SunatEstado.observado)
      return 'Comprobante observado por SUNAT';
    return 'Comprobante no aceptado por SUNAT';
  }

  private sunatMessage(status: SunatEstado) {
    if (status === SunatEstado.aceptado) return 'aceptado por SUNAT';
    if (status === SunatEstado.observado) return 'aceptado con observaciones';
    if (status === SunatEstado.rechazado) return 'rechazado por SUNAT';
    return 'no pudo enviarse a SUNAT';
  }

  private limaPeriod(date: Date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Lima',
      year: 'numeric',
      month: '2-digit',
    }).formatToParts(date);
    const year = parts.find(({ type }) => type === 'year')?.value;
    const month = parts.find(({ type }) => type === 'month')?.value;
    return `${year}-${month}`;
  }

  private async safeRun(label: string, task: () => Promise<void>) {
    try {
      await task();
    } catch (error) {
      this.logger.error(
        `Error procesando ${label}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
