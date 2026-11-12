import { Injectable, NotFoundException } from '@nestjs/common';
import {
  CajaMovimientoTipo,
  CajaSesionEstado,
  Prisma,
  VentaEstado,
  VentaFormaPago,
  VentaTipoComprobante,
} from '@prisma/client';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import {
  scopedCreatorId,
  type CommercialScope,
} from '../../common/commercial-access';
import { PrismaService } from '../../prisma/prisma.service';
import { LocalPdfLogoStorageService } from '../storage/local-pdf-logo-storage.service';

export type CashRegisterPdfFormat = 'ticket80' | 'a4';

const cashRegisterPdfInclude = {
  empresa: {
    select: {
      id: true,
      nombreComercial: true,
      razonSocial: true,
      ruc: true,
      direccion: true,
      logoUrl: true,
      logoPdfUrl: true,
    },
  },
  sucursal: { select: { nombre: true } },
  usuario: { select: { nombre: true, apellido: true } },
  movimientos: {
    include: { metodoPago: { select: { nombre: true, nombreKey: true } } },
    orderBy: { createdAt: 'asc' },
  },
  ventas: {
    select: {
      estado: true,
      tipoComprobante: true,
      formaPago: true,
      total: true,
    },
  },
} satisfies Prisma.CajaSesionInclude;

type CashRegisterForPdf = Prisma.CajaSesionGetPayload<{
  include: typeof cashRegisterPdfInclude;
}>;

type PdfAssets = { logo: Buffer | null };
type PdfFonts = { regular: string; bold: string; extraBold: string };

type ReportRow = {
  label: string;
  total: Prisma.Decimal;
};

type ReportComprobante = {
  label: string;
  count: number;
  total: Prisma.Decimal;
};

type CashRegisterReport = {
  publicId: string;
  title: string;
  isOpen: boolean;
  empresa: {
    name: string;
    ruc: string | null;
    address: string | null;
  };
  sucursal: string;
  usuario: string;
  openedAt: Date;
  closedAt: Date | null;
  byMethod: ReportRow[];
  totalCobrado: Prisma.Decimal;
  cobrosFiados: Prisma.Decimal;
  cobrosFiadosCount: number;
  ventasCount: number;
  vendidoCredito: Prisma.Decimal;
  comprobantes: ReportComprobante[];
  cash: {
    initial: Prisma.Decimal;
    sales: Prisma.Decimal;
    incomes: Prisma.Decimal;
    withdrawals: Prisma.Decimal;
    expected: Prisma.Decimal;
  };
  totalEsperado: Prisma.Decimal;
  montoDeclarado: Prisma.Decimal | null;
  diferencia: Prisma.Decimal | null;
  observacionesCierre: string | null;
};

const MM = 72 / 25.4;
const TICKET_WIDTH = 80 * MM;
const PAGE_MARGIN = 14 * MM;
const INK = '#111111';
const MUTED = '#5F6368';
const BORDER = '#B4B9BF';
const SOFT_BORDER = '#E1E4E8';
const SOFT_FILL = '#F6F7F9';

const comprobanteLabels: Record<VentaTipoComprobante, string> = {
  nota_venta: 'Tickets internos',
  boleta: 'Boletas',
  factura: 'Facturas',
  guia_remision: 'Guias de remision',
  nota_credito_factura: 'Notas de credito',
  nota_credito_boleta: 'Notas de credito',
  nota_debito_factura: 'Notas de debito',
  nota_debito_boleta: 'Notas de debito',
};

const comprobanteOrder: VentaTipoComprobante[] = [
  VentaTipoComprobante.boleta,
  VentaTipoComprobante.factura,
  VentaTipoComprobante.nota_venta,
  VentaTipoComprobante.guia_remision,
  VentaTipoComprobante.nota_credito_factura,
  VentaTipoComprobante.nota_credito_boleta,
  VentaTipoComprobante.nota_debito_factura,
  VentaTipoComprobante.nota_debito_boleta,
];

@Injectable()
export class CashRegisterPdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly localPdfLogoStorageService: LocalPdfLogoStorageService,
  ) {}

  async generate(
    empresaId: bigint,
    scope: CommercialScope,
    publicId: string,
    format: CashRegisterPdfFormat,
  ) {
    const session = await this.findSession(empresaId, scope, publicId);
    const report = this.buildReport(session);
    const assets: PdfAssets = { logo: await this.buildLogoBuffer(session) };
    const buffer =
      format === 'a4'
        ? await this.createA4(report, assets)
        : await this.createTicket(report, assets);

    return {
      buffer,
      fileName: this.buildFileName(report, format),
    };
  }

  private async findSession(
    empresaId: bigint,
    scope: CommercialScope,
    publicId: string,
  ) {
    const cashRegister = await this.prisma.cajaSesion.findFirst({
      where: {
        empresaId,
        publicId,
        ...(scope.branchId ? { sucursalId: scope.branchId } : {}),
        ...(scopedCreatorId(scope)
          ? { usuarioId: scopedCreatorId(scope)! }
          : {}),
      },
      include: cashRegisterPdfInclude,
    });

    if (!cashRegister) {
      throw new NotFoundException('Caja no encontrada');
    }

    return cashRegister;
  }

  private buildReport(session: CashRegisterForPdf): CashRegisterReport {
    const saleTypes = new Set<CajaMovimientoTipo>([
      CajaMovimientoTipo.venta,
      CajaMovimientoTipo.cobranza,
      CajaMovimientoTipo.anulacion_venta,
      CajaMovimientoTipo.anulacion_cobranza,
    ]);

    const byMethod = new Map<string, ReportRow>();
    let totalCobrado = new Prisma.Decimal(0);
    let cobrosFiados = new Prisma.Decimal(0);
    let cobrosFiadosCount = 0;
    let cashInitial = new Prisma.Decimal(0);
    let cashSales = new Prisma.Decimal(0);
    let cashIncomes = new Prisma.Decimal(0);
    let cashWithdrawals = new Prisma.Decimal(0);
    let cashExpected = new Prisma.Decimal(0);
    let movementsTotal = new Prisma.Decimal(0);

    for (const movement of session.movimientos) {
      const isCash =
        (movement.metodoPago?.nombreKey ?? '').trim().toLowerCase() ===
        'efectivo';

      movementsTotal = movementsTotal.add(movement.monto);

      if (isCash) {
        cashExpected = cashExpected.add(movement.monto);
      }

      if (movement.tipo === CajaMovimientoTipo.apertura) {
        if (isCash) {
          cashInitial = cashInitial.add(movement.monto);
        }
        continue;
      }

      if (saleTypes.has(movement.tipo)) {
        totalCobrado = totalCobrado.add(movement.monto);

        if (isCash) {
          cashSales = cashSales.add(movement.monto);
        }

        if (
          movement.tipo === CajaMovimientoTipo.cobranza ||
          movement.tipo === CajaMovimientoTipo.anulacion_cobranza
        ) {
          cobrosFiados = cobrosFiados.add(movement.monto);
          if (movement.tipo === CajaMovimientoTipo.cobranza) {
            cobrosFiadosCount += 1;
          }
        }

        const label = movement.metodoPago?.nombre ?? 'Sin metodo';
        const current = byMethod.get(label) ?? {
          label,
          total: new Prisma.Decimal(0),
        };
        current.total = current.total.add(movement.monto);
        byMethod.set(label, current);
        continue;
      }

      if (movement.tipo === CajaMovimientoTipo.ingreso) {
        if (isCash) {
          cashIncomes = cashIncomes.add(movement.monto);
        }
        continue;
      }

      if (movement.tipo === CajaMovimientoTipo.retiro) {
        if (isCash) {
          cashWithdrawals = cashWithdrawals.add(movement.monto);
        }
      }
    }

    const activeVentas = session.ventas.filter(
      (venta) => venta.estado !== VentaEstado.anulada,
    );
    const vendidoCredito = activeVentas
      .filter((venta) => venta.formaPago === VentaFormaPago.CREDITO)
      .reduce((sum, venta) => sum.add(venta.total), new Prisma.Decimal(0));

    const comprobantesMap = new Map<string, ReportComprobante>();
    const comprobanteIndex = new Map<string, number>();

    for (const venta of activeVentas) {
      const label = comprobanteLabels[venta.tipoComprobante];
      const current = comprobantesMap.get(label) ?? {
        label,
        count: 0,
        total: new Prisma.Decimal(0),
      };
      current.count += 1;
      current.total = current.total.add(venta.total);
      comprobantesMap.set(label, current);
      comprobanteIndex.set(
        label,
        comprobanteOrder.indexOf(venta.tipoComprobante),
      );
    }

    const comprobantes = Array.from(comprobantesMap.values()).sort(
      (a, b) =>
        (comprobanteIndex.get(a.label) ?? 99) -
        (comprobanteIndex.get(b.label) ?? 99),
    );

    const usuario = `${session.usuario.nombre} ${
      session.usuario.apellido ?? ''
    }`
      .replace(/\s+/g, ' ')
      .trim();

    return {
      publicId: session.publicId,
      title:
        session.estado === CajaSesionEstado.abierta
          ? 'ARQUEO PARCIAL'
          : 'ARQUEO FINAL',
      isOpen: session.estado === CajaSesionEstado.abierta,
      empresa: {
        name:
          session.empresa.razonSocial ||
          session.empresa.nombreComercial ||
          'Empresa',
        ruc: session.empresa.ruc,
        address: session.empresa.direccion,
      },
      sucursal: session.sucursal.nombre,
      usuario,
      openedAt: session.openedAt,
      closedAt: session.closedAt,
      byMethod: Array.from(byMethod.values()).filter(
        (item) => !item.total.equals(0),
      ),
      totalCobrado,
      cobrosFiados,
      cobrosFiadosCount,
      ventasCount: activeVentas.length,
      vendidoCredito,
      comprobantes,
      cash: {
        initial: cashInitial,
        sales: cashSales,
        incomes: cashIncomes,
        withdrawals: cashWithdrawals,
        expected: cashExpected,
      },
      totalEsperado: session.montoEsperado ?? movementsTotal,
      montoDeclarado: session.montoDeclarado,
      diferencia: session.diferencia,
      observacionesCierre: session.observacionesCierre,
    };
  }

  private buildFileName(
    report: CashRegisterReport,
    format: CashRegisterPdfFormat,
  ) {
    const slug =
      report.sucursal
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'caja';
    const date = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: 'America/Lima',
    }).format(report.openedAt);

    return `arqueo-caja-${slug}-${date}-${format === 'a4' ? 'a4' : '80mm'}.pdf`;
  }

  private createPdf(
    options: PDFKit.PDFDocumentOptions,
    render: (doc: PDFKit.PDFDocument) => void,
  ) {
    return new Promise<Buffer>((resolveBuffer, reject) => {
      const doc = new PDFDocument(options);
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolveBuffer(Buffer.concat(chunks)));
      doc.on('error', reject);

      render(doc);
      doc.end();
    });
  }

  private async createTicket(report: CashRegisterReport, assets: PdfAssets) {
    const measureDoc = new PDFDocument({
      size: [TICKET_WIDTH, 8000],
      margin: 0,
    });
    measureDoc.on('data', () => undefined);
    const height = this.renderTicket(measureDoc, report, assets);
    measureDoc.end();

    return this.createPdf(
      {
        size: [TICKET_WIDTH, Math.max(220, Math.ceil(height + 10))],
        margin: 0,
        info: { Title: `${report.title} ${report.publicId}` },
      },
      (doc) => this.renderTicket(doc, report, assets),
    );
  }

  private createA4(report: CashRegisterReport, assets: PdfAssets) {
    return this.createPdf(
      {
        size: 'A4',
        margins: {
          top: PAGE_MARGIN,
          right: PAGE_MARGIN,
          bottom: PAGE_MARGIN,
          left: PAGE_MARGIN,
        },
        info: { Title: `${report.title} ${report.publicId}` },
      },
      (doc) => this.renderA4(doc, report, assets),
    );
  }

  private renderTicket(
    doc: PDFKit.PDFDocument,
    report: CashRegisterReport,
    assets: PdfAssets,
  ) {
    const fonts = this.registerFonts(doc);
    const padding = 9;
    const left = padding;
    const width = TICKET_WIDTH - padding * 2;
    let y = 10;

    doc.fillColor(INK);

    if (assets.logo) {
      doc.image(assets.logo, (TICKET_WIDTH - 100) / 2, y, {
        fit: [100, 42],
        align: 'center',
        valign: 'center',
      });
      y += 46;
    }

    y = this.writeText(doc, fonts, report.empresa.name, left, y, {
      width,
      align: 'center',
      size: 9,
      weight: 'bold',
    });

    if (report.empresa.ruc) {
      y = this.writeText(
        doc,
        fonts,
        `RUC: ${report.empresa.ruc}`,
        left,
        y + 1,
        { width, align: 'center', size: 7.5, weight: 'bold' },
      );
    }

    if (report.empresa.address) {
      y = this.writeText(doc, fonts, report.empresa.address, left, y + 1, {
        width,
        align: 'center',
        size: 6.8,
        color: MUTED,
      });
    }

    y += 5;
    y = this.ticketDivider(doc, left, y, width);

    y = this.writeText(doc, fonts, report.title, left, y, {
      width,
      align: 'center',
      size: 10.5,
      weight: 'extraBold',
    });
    y = this.writeText(
      doc,
      fonts,
      report.isOpen
        ? 'El turno sigue abierto. Las cifras pueden cambiar.'
        : 'Turno cerrado. Cifras definitivas.',
      left,
      y + 1,
      { width, align: 'center', size: 6.6, color: MUTED },
    );

    y += 3;
    y = this.ticketDivider(doc, left, y, width);

    y = this.ticketRow(doc, fonts, 'Sucursal', report.sucursal, left, y, width);
    y = this.ticketRow(
      doc,
      fonts,
      'Caja',
      this.shortCode(report.publicId),
      left,
      y,
      width,
    );
    y = this.ticketRow(doc, fonts, 'Abrio', report.usuario, left, y, width);
    y = this.ticketRow(
      doc,
      fonts,
      'Apertura',
      this.formatDateTime(report.openedAt),
      left,
      y,
      width,
    );
    if (report.closedAt) {
      y = this.ticketRow(
        doc,
        fonts,
        'Cierre',
        this.formatDateTime(report.closedAt),
        left,
        y,
        width,
      );
    }

    y += 2;
    y = this.ticketDivider(doc, left, y, width);

    y = this.ticketSection(doc, fonts, 'VENTAS DEL TURNO', left, y, width);

    if (report.byMethod.length > 0) {
      for (const item of report.byMethod) {
        y = this.ticketRow(
          doc,
          fonts,
          item.label,
          this.formatMoney(item.total),
          left,
          y,
          width,
        );
      }
    } else {
      y = this.writeText(doc, fonts, 'Sin ventas registradas.', left, y, {
        width,
        size: 7.2,
        color: MUTED,
      });
    }

    y += 2;
    y = this.ticketDivider(doc, left, y, width);

    y = this.ticketRow(
      doc,
      fonts,
      'Total cobrado',
      this.formatMoney(report.totalCobrado),
      left,
      y,
      width,
      { strong: true },
    );

    if (report.cobrosFiados.gt(0)) {
      const label =
        report.cobrosFiadosCount > 0
          ? `Incluye cobros de fiados (${report.cobrosFiadosCount})`
          : 'Incluye cobros de fiados';
      y = this.ticketRow(
        doc,
        fonts,
        label,
        this.formatMoney(report.cobrosFiados),
        left,
        y,
        width,
      );
    }

    y = this.ticketRow(
      doc,
      fonts,
      'N. de ventas',
      String(report.ventasCount),
      left,
      y,
      width,
    );

    if (report.vendidoCredito.gt(0)) {
      y = this.ticketRow(
        doc,
        fonts,
        'Vendido al credito',
        this.formatMoney(report.vendidoCredito),
        left,
        y,
        width,
      );
    }

    y += 2;
    y = this.ticketDivider(doc, left, y, width);

    y = this.ticketSection(doc, fonts, 'COMPROBANTES', left, y, width);

    if (report.comprobantes.length > 0) {
      for (const item of report.comprobantes) {
        y = this.ticketRow(
          doc,
          fonts,
          `${item.label} (${item.count})`,
          this.formatMoney(item.total),
          left,
          y,
          width,
        );
      }
    } else {
      y = this.writeText(doc, fonts, 'Sin comprobantes registrados.', left, y, {
        width,
        size: 7.2,
        color: MUTED,
      });
    }

    y += 2;
    y = this.ticketDivider(doc, left, y, width);

    y = this.ticketSection(doc, fonts, 'ARQUEO DE EFECTIVO', left, y, width);
    y = this.ticketRow(
      doc,
      fonts,
      'Fondo inicial',
      this.formatMoney(report.cash.initial),
      left,
      y,
      width,
    );
    y = this.ticketRow(
      doc,
      fonts,
      'Ventas en efectivo',
      this.formatMoney(report.cash.sales),
      left,
      y,
      width,
    );

    if (!report.cash.incomes.equals(0)) {
      y = this.ticketRow(
        doc,
        fonts,
        'Ingresos en efectivo',
        this.formatMoney(report.cash.incomes),
        left,
        y,
        width,
      );
    }

    if (!report.cash.withdrawals.equals(0)) {
      y = this.ticketRow(
        doc,
        fonts,
        'Retiros en efectivo',
        this.formatMoney(report.cash.withdrawals),
        left,
        y,
        width,
      );
    }

    y += 1;
    y = this.ticketDivider(doc, left, y, width);
    y = this.ticketRow(
      doc,
      fonts,
      'Efectivo esperado',
      this.formatMoney(report.cash.expected),
      left,
      y,
      width,
      { strong: true },
    );

    y += 1;
    y = this.ticketDivider(doc, left, y, width);

    if (!report.isOpen) {
      y = this.ticketSection(doc, fonts, 'CIERRE DE CAJA', left, y, width);
      y = this.ticketRow(
        doc,
        fonts,
        'Total esperado',
        this.formatMoney(report.totalEsperado),
        left,
        y,
        width,
      );
      y = this.ticketRow(
        doc,
        fonts,
        'Total declarado',
        this.formatMoney(report.montoDeclarado),
        left,
        y,
        width,
      );
      y = this.ticketRow(
        doc,
        fonts,
        'Diferencia',
        this.formatMoney(report.diferencia),
        left,
        y,
        width,
        { strong: true },
      );

      if (report.observacionesCierre) {
        y = this.writeText(
          doc,
          fonts,
          `Observaciones: ${report.observacionesCierre}`,
          left,
          y + 1,
          { width, size: 7, color: MUTED },
        );
      }

      y += 2;
      y = this.ticketDivider(doc, left, y, width);
    }

    y = this.writeText(
      doc,
      fonts,
      `Generado: ${this.formatDateTime(new Date())}`,
      left,
      y,
      { width, align: 'center', size: 6.6, color: MUTED },
    );
    y = this.writeText(
      doc,
      fonts,
      'Reporte interno sin validez tributaria.',
      left,
      y + 1,
      { width, align: 'center', size: 6.6, color: MUTED },
    );

    return y + 8;
  }

  private renderA4(
    doc: PDFKit.PDFDocument,
    report: CashRegisterReport,
    assets: PdfAssets,
  ) {
    const fonts = this.registerFonts(doc);
    const pageWidth = doc.page.width;
    const contentX = PAGE_MARGIN;
    const contentWidth = pageWidth - PAGE_MARGIN * 2;
    const headerTop = PAGE_MARGIN;

    doc.fillColor(INK);

    const titleBlockWidth = 164;
    const titleBlockX = pageWidth - PAGE_MARGIN - titleBlockWidth;
    let textX = contentX;

    if (assets.logo) {
      doc.image(assets.logo, contentX, headerTop, {
        fit: [122, 58],
        valign: 'center',
      });
      textX = contentX + 136;
    }

    const infoWidth = Math.max(180, titleBlockX - textX - 18);
    let headerTextY = this.writeText(
      doc,
      fonts,
      report.empresa.name,
      textX,
      headerTop,
      { width: infoWidth, size: 14, weight: 'extraBold' },
    );

    if (report.empresa.ruc) {
      headerTextY = this.writeText(
        doc,
        fonts,
        `RUC: ${report.empresa.ruc}`,
        textX,
        headerTextY + 3,
        { width: infoWidth, size: 9, weight: 'bold' },
      );
    }

    if (report.empresa.address) {
      headerTextY = this.writeText(
        doc,
        fonts,
        report.empresa.address,
        textX,
        headerTextY + 2,
        { width: infoWidth, size: 8, color: MUTED },
      );
    }

    const titleBlockHeight = 58;
    doc
      .roundedRect(titleBlockX, headerTop, titleBlockWidth, titleBlockHeight, 8)
      .fillAndStroke(SOFT_FILL, SOFT_BORDER);
    this.writeText(doc, fonts, report.title, titleBlockX, headerTop + 11, {
      width: titleBlockWidth,
      align: 'center',
      size: 13,
      weight: 'extraBold',
    });
    this.writeText(
      doc,
      fonts,
      report.isOpen ? 'Caja abierta' : 'Caja cerrada',
      titleBlockX,
      headerTop + 30,
      { width: titleBlockWidth, align: 'center', size: 8, color: MUTED },
    );
    this.writeText(
      doc,
      fonts,
      this.formatDateTime(report.openedAt),
      titleBlockX,
      headerTop + 42,
      { width: titleBlockWidth, align: 'center', size: 7.5, color: MUTED },
    );

    let y =
      Math.max(headerTextY, headerTop + titleBlockHeight) + PAGE_MARGIN * 0.5;

    doc
      .moveTo(contentX, y)
      .lineTo(contentX + contentWidth, y)
      .lineWidth(0.8)
      .strokeColor(SOFT_BORDER)
      .stroke();
    y += 12;

    const infoRows: Array<[string, string]> = [
      ['Sucursal', report.sucursal],
      ['Caja', this.shortCode(report.publicId)],
      ['Usuario', report.usuario],
      ['Apertura', this.formatDateTime(report.openedAt)],
    ];

    if (report.closedAt) {
      infoRows.push(['Cierre', this.formatDateTime(report.closedAt)]);
    }

    const gridGap = 12;
    const cardWidth = (contentWidth - gridGap) / 2;
    for (let index = 0; index < infoRows.length; index += 2) {
      const row = infoRows.slice(index, index + 2);
      let cardX = contentX;

      for (const [label, value] of row) {
        this.a4InfoCard(doc, fonts, cardX, y, cardWidth, label, value);
        cardX += cardWidth + gridGap;
      }

      y += 42;
    }

    y += 4;

    const columnGap = 20;
    const columnWidth = (contentWidth - columnGap) / 2;
    const leftX = contentX;
    const rightX = contentX + columnWidth + columnGap;

    let leftY = y;
    leftY = this.a4Section(
      doc,
      fonts,
      'Ventas del turno',
      leftX,
      leftY,
      columnWidth,
    );

    if (report.byMethod.length > 0) {
      for (const item of report.byMethod) {
        leftY = this.a4Row(
          doc,
          fonts,
          item.label,
          this.formatMoney(item.total),
          leftX,
          leftY,
          columnWidth,
        );
      }
    } else {
      leftY = this.writeText(
        doc,
        fonts,
        'Sin ventas registradas.',
        leftX,
        leftY,
        {
          width: columnWidth,
          size: 8.5,
          color: MUTED,
        },
      );
    }

    leftY = this.a4Divider(doc, leftX, leftY + 2, columnWidth);
    leftY = this.a4Row(
      doc,
      fonts,
      'Total cobrado',
      this.formatMoney(report.totalCobrado),
      leftX,
      leftY,
      columnWidth,
      { strong: true },
    );

    if (report.cobrosFiados.gt(0)) {
      const label =
        report.cobrosFiadosCount > 0
          ? `Incluye cobros de fiados (${report.cobrosFiadosCount})`
          : 'Incluye cobros de fiados';
      leftY = this.a4Row(
        doc,
        fonts,
        label,
        this.formatMoney(report.cobrosFiados),
        leftX,
        leftY,
        columnWidth,
      );
    }

    leftY = this.a4Row(
      doc,
      fonts,
      'N. de ventas',
      String(report.ventasCount),
      leftX,
      leftY,
      columnWidth,
    );

    if (report.vendidoCredito.gt(0)) {
      leftY = this.a4Row(
        doc,
        fonts,
        'Vendido al credito',
        this.formatMoney(report.vendidoCredito),
        leftX,
        leftY,
        columnWidth,
      );
    }

    leftY += 14;
    leftY = this.a4Section(
      doc,
      fonts,
      'Comprobantes',
      leftX,
      leftY,
      columnWidth,
    );

    if (report.comprobantes.length > 0) {
      for (const item of report.comprobantes) {
        leftY = this.a4Row(
          doc,
          fonts,
          `${item.label} (${item.count})`,
          this.formatMoney(item.total),
          leftX,
          leftY,
          columnWidth,
        );
      }
    } else {
      leftY = this.writeText(
        doc,
        fonts,
        'Sin comprobantes registrados.',
        leftX,
        leftY,
        { width: columnWidth, size: 8.5, color: MUTED },
      );
    }

    let rightY = y;
    rightY = this.a4Section(
      doc,
      fonts,
      'Arqueo de efectivo',
      rightX,
      rightY,
      columnWidth,
    );
    rightY = this.a4Row(
      doc,
      fonts,
      'Fondo inicial',
      this.formatMoney(report.cash.initial),
      rightX,
      rightY,
      columnWidth,
    );
    rightY = this.a4Row(
      doc,
      fonts,
      'Ventas en efectivo',
      this.formatMoney(report.cash.sales),
      rightX,
      rightY,
      columnWidth,
    );

    if (!report.cash.incomes.equals(0)) {
      rightY = this.a4Row(
        doc,
        fonts,
        'Ingresos en efectivo',
        this.formatMoney(report.cash.incomes),
        rightX,
        rightY,
        columnWidth,
      );
    }

    if (!report.cash.withdrawals.equals(0)) {
      rightY = this.a4Row(
        doc,
        fonts,
        'Retiros en efectivo',
        this.formatMoney(report.cash.withdrawals),
        rightX,
        rightY,
        columnWidth,
      );
    }

    rightY = this.a4Divider(doc, rightX, rightY + 2, columnWidth);
    rightY = this.a4Row(
      doc,
      fonts,
      'Efectivo esperado',
      this.formatMoney(report.cash.expected),
      rightX,
      rightY,
      columnWidth,
      { strong: true },
    );

    rightY += 14;

    if (!report.isOpen) {
      rightY = this.a4Section(
        doc,
        fonts,
        'Cierre de caja',
        rightX,
        rightY,
        columnWidth,
      );
      rightY = this.a4Row(
        doc,
        fonts,
        'Total esperado',
        this.formatMoney(report.totalEsperado),
        rightX,
        rightY,
        columnWidth,
      );
      rightY = this.a4Row(
        doc,
        fonts,
        'Total declarado',
        this.formatMoney(report.montoDeclarado),
        rightX,
        rightY,
        columnWidth,
      );
      rightY = this.a4Row(
        doc,
        fonts,
        'Diferencia',
        this.formatMoney(report.diferencia),
        rightX,
        rightY,
        columnWidth,
        { strong: true },
      );

      if (report.observacionesCierre) {
        rightY = this.writeText(
          doc,
          fonts,
          `Observaciones: ${report.observacionesCierre}`,
          rightX,
          rightY + 2,
          { width: columnWidth, size: 8, color: MUTED },
        );
      }
    } else {
      rightY = this.a4Section(
        doc,
        fonts,
        'Estado del turno',
        rightX,
        rightY,
        columnWidth,
      );
      rightY = this.writeText(
        doc,
        fonts,
        'El turno sigue abierto. Las cifras pueden cambiar hasta el cierre de caja.',
        rightX,
        rightY,
        { width: columnWidth, size: 8.5, color: MUTED },
      );
    }

    let footerY = Math.max(leftY, rightY) + 22;

    doc
      .moveTo(contentX, footerY)
      .lineTo(contentX + contentWidth, footerY)
      .lineWidth(0.8)
      .strokeColor(SOFT_BORDER)
      .stroke();
    footerY += 6;

    this.writeText(
      doc,
      fonts,
      `Reporte generado el ${this.formatDateTime(new Date())}. Documento interno sin validez tributaria.`,
      contentX,
      footerY,
      { width: contentWidth, size: 7.5, color: MUTED },
    );
  }

  private writeText(
    doc: PDFKit.PDFDocument,
    fonts: PdfFonts,
    value: string,
    x: number,
    y: number,
    options: {
      width: number;
      align?: 'left' | 'right' | 'center';
      size: number;
      weight?: keyof PdfFonts;
      color?: string;
    },
  ) {
    doc
      .font(fonts[options.weight ?? 'regular'])
      .fontSize(options.size)
      .fillColor(options.color ?? INK);

    const height = doc.heightOfString(value, { width: options.width });
    doc.text(value, x, y, {
      width: options.width,
      align: options.align ?? 'left',
    });

    return y + height;
  }

  private ticketRow(
    doc: PDFKit.PDFDocument,
    fonts: PdfFonts,
    label: string,
    value: string,
    x: number,
    y: number,
    width: number,
    options: { strong?: boolean; size?: number } = {},
  ) {
    const size = options.size ?? 7.6;
    const labelWidth = width * 0.64;
    const valueWidth = width - labelWidth;
    const labelWeight: keyof PdfFonts = options.strong ? 'bold' : 'regular';
    const valueWeight: keyof PdfFonts = 'bold';

    doc.font(fonts[labelWeight]).fontSize(size);
    const labelHeight = doc.heightOfString(label, { width: labelWidth });
    doc.font(fonts[valueWeight]).fontSize(size);
    const valueHeight = doc.heightOfString(value, {
      width: valueWidth,
      align: 'right',
    });
    const rowHeight = Math.max(labelHeight, valueHeight);

    doc
      .font(fonts[labelWeight])
      .fontSize(size)
      .fillColor(INK)
      .text(label, x, y, { width: labelWidth });
    doc
      .font(fonts[valueWeight])
      .fontSize(size)
      .fillColor(INK)
      .text(value, x + labelWidth, y, {
        width: valueWidth,
        align: 'right',
      });

    return y + rowHeight + 2.4;
  }

  private ticketSection(
    doc: PDFKit.PDFDocument,
    fonts: PdfFonts,
    title: string,
    x: number,
    y: number,
    width: number,
  ) {
    const nextY = this.writeText(doc, fonts, title, x, y, {
      width,
      align: 'center',
      size: 7.6,
      weight: 'extraBold',
    });

    return nextY + 2;
  }

  private ticketDivider(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    width: number,
  ) {
    doc
      .moveTo(x, y)
      .lineTo(x + width, y)
      .lineWidth(0.6)
      .dash(2, { space: 2 })
      .strokeColor(BORDER)
      .stroke()
      .undash();

    return y + 6;
  }

  private a4InfoCard(
    doc: PDFKit.PDFDocument,
    fonts: PdfFonts,
    x: number,
    y: number,
    width: number,
    label: string,
    value: string,
  ) {
    doc.roundedRect(x, y, width, 34, 6).fillAndStroke(SOFT_FILL, SOFT_BORDER);
    this.writeText(doc, fonts, label.toUpperCase(), x + 9, y + 6, {
      width: width - 18,
      size: 6.8,
      color: MUTED,
    });
    this.writeText(doc, fonts, value, x + 9, y + 16, {
      width: width - 18,
      size: 8.8,
      weight: 'bold',
    });
  }

  private a4Section(
    doc: PDFKit.PDFDocument,
    fonts: PdfFonts,
    title: string,
    x: number,
    y: number,
    width: number,
  ) {
    const nextY = this.writeText(doc, fonts, title.toUpperCase(), x, y, {
      width,
      size: 8.5,
      weight: 'extraBold',
    });

    doc
      .moveTo(x, nextY + 3)
      .lineTo(x + width, nextY + 3)
      .lineWidth(1)
      .strokeColor(SOFT_BORDER)
      .stroke();

    return nextY + 10;
  }

  private a4Row(
    doc: PDFKit.PDFDocument,
    fonts: PdfFonts,
    label: string,
    value: string,
    x: number,
    y: number,
    width: number,
    options: { strong?: boolean; size?: number; color?: string } = {},
  ) {
    const size = options.size ?? 8.6;
    const valueWidth = width * 0.44;
    const labelWidth = width - valueWidth;

    doc.font(fonts[options.strong ? 'bold' : 'regular']).fontSize(size);
    const labelHeight = doc.heightOfString(label, { width: labelWidth });
    const rowHeight = Math.max(13, labelHeight);

    this.writeText(doc, fonts, label, x, y, {
      width: labelWidth,
      size,
      weight: options.strong ? 'bold' : 'regular',
      color: options.color,
    });
    this.writeText(doc, fonts, value, x + labelWidth, y, {
      width: valueWidth,
      align: 'right',
      size,
      weight: 'bold',
      color: options.color,
    });

    return y + rowHeight + 3;
  }

  private a4Divider(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    width: number,
  ) {
    doc
      .moveTo(x, y)
      .lineTo(x + width, y)
      .lineWidth(0.6)
      .strokeColor(SOFT_BORDER)
      .stroke();

    return y + 7;
  }

  private registerFonts(doc: PDFKit.PDFDocument): PdfFonts {
    const fontDir = resolve(
      process.cwd(),
      '..',
      '..',
      'nobitex',
      'public',
      'font',
    );
    const paths = {
      regular: resolve(fontDir, 'PlusJakartaSans-Regular.ttf'),
      bold: resolve(fontDir, 'PlusJakartaSans-Bold.ttf'),
      extraBold: resolve(fontDir, 'PlusJakartaSans-ExtraBold.ttf'),
    };

    if (Object.values(paths).every(existsSync)) {
      doc.registerFont('Jakarta', paths.regular);
      doc.registerFont('JakartaBold', paths.bold);
      doc.registerFont('JakartaExtraBold', paths.extraBold);
      return {
        regular: 'Jakarta',
        bold: 'JakartaBold',
        extraBold: 'JakartaExtraBold',
      };
    }

    return {
      regular: 'Helvetica',
      bold: 'Helvetica-Bold',
      extraBold: 'Helvetica-Bold',
    };
  }

  private shortCode(publicId: string) {
    return `#${publicId.slice(-8).toUpperCase()}`;
  }

  private formatMoney(value: Prisma.Decimal | null | undefined) {
    const amount = Number(value ?? 0);
    const safeAmount = Number.isFinite(amount) ? amount : 0;
    const sign = safeAmount < 0 ? '-' : '';
    const [integer, decimals] = Math.abs(safeAmount).toFixed(2).split('.');
    const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

    return `${sign}S/ ${grouped}.${decimals}`;
  }

  private formatDateTime(value: Date | null) {
    if (!value) {
      return '-';
    }

    const parts = new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'America/Lima',
    }).formatToParts(value);
    const get = (type: string) =>
      parts.find((part) => part.type === type)?.value ?? '';

    return `${get('day')}/${get('month')}/${get('year')} ${get(
      'hour',
    )}:${get('minute')}`;
  }

  private async buildLogoBuffer(session: CashRegisterForPdf) {
    const dataUri = await this.resolveCompanyLogoDataUri(session);
    if (!dataUri) {
      return null;
    }

    try {
      const encoded = dataUri.slice(dataUri.indexOf(',') + 1);
      return await sharp(Buffer.from(encoded, 'base64')).png().toBuffer();
    } catch {
      return null;
    }
  }

  private async resolveCompanyLogoDataUri(session: CashRegisterForPdf) {
    const localLogo = await this.localPdfLogoStorageService.resolveToDataUri(
      session.empresa.logoPdfUrl,
    );
    if (localLogo) {
      return localLogo;
    }

    if (session.empresa.logoUrl) {
      const stored =
        await this.localPdfLogoStorageService.saveCompanyLogoFromUrl({
          empresaId: session.empresa.id,
          imageUrl: session.empresa.logoUrl,
          previousUrl: session.empresa.logoPdfUrl,
        });

      if (stored) {
        await this.prisma.empresa.update({
          where: { id: session.empresa.id },
          data: { logoPdfUrl: stored.url },
        });
        return this.localPdfLogoStorageService.resolveToDataUri(stored.url);
      }
    }

    return this.resolveRemoteImageDataUri(session.empresa.logoUrl);
  }

  private async resolveRemoteImageDataUri(url: string | null) {
    if (!url) {
      return null;
    }

    try {
      const response = await fetch(url);
      if (!response.ok) {
        return null;
      }
      const contentType =
        response.headers.get('content-type') ?? this.inferImageMimeType(url);
      const buffer = Buffer.from(await response.arrayBuffer());
      return `data:${contentType};base64,${buffer.toString('base64')}`;
    } catch {
      return null;
    }
  }

  private inferImageMimeType(url: string) {
    const normalized = url.toLowerCase().split('?')[0];
    if (normalized.endsWith('.png')) return 'image/png';
    if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) {
      return 'image/jpeg';
    }
    if (normalized.endsWith('.webp')) return 'image/webp';
    if (normalized.endsWith('.svg')) return 'image/svg+xml';
    return 'application/octet-stream';
  }
}
