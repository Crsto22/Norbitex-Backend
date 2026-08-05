import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ClienteTipoDocumento,
  Prisma,
  ProductoTipo,
  SunatEstado,
  VentaTipoComprobante,
} from '@prisma/client';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { PrismaService } from '../../prisma/prisma.service';
import { LocalPdfLogoStorageService } from '../storage/local-pdf-logo-storage.service';
import {
  buildQrContent,
  isCreditNoteType,
  isElectronicSaleType,
} from '../sunat-emission/sunat-comprobante.helper';

const salePdfInclude = {
  empresa: {
    select: {
      id: true,
      nombreComercial: true,
      razonSocial: true,
      ruc: true,
      direccion: true,
      logoUrl: true,
      logoPdfUrl: true,
      sunatConfig: {
        select: {
          ambiente: true,
        },
      },
    },
  },
  sucursal: {
    select: {
      nombre: true,
      direccion: true,
      distrito: true,
      ubigeo: true,
    },
  },
  cliente: {
    select: {
      nombre: true,
      razonSocial: true,
      tipoDocumento: true,
      numeroDocumento: true,
      direccion: true,
    },
  },
  detalles: {
    include: {
      productoVariante: {
        include: {
          producto: { select: { nombre: true, tipo: true } },
          productoColor: {
            include: {
              color: { select: { nombre: true } },
            },
          },
          talla: { select: { nombre: true } },
        },
      },
    },
  },
  pagos: {
    include: {
      metodoPago: { select: { nombre: true } },
    },
  },
} satisfies Prisma.VentaInclude;

type SaleForPdf = Prisma.VentaGetPayload<{ include: typeof salePdfInclude }>;
type PdfAssets = { logo: Buffer | null; qr: Buffer | null };
type PdfFonts = { regular: string; bold: string; extraBold: string };

export type CommercialDocumentPdfInput = {
  issuer: {
    name: string;
    tradeName: string;
    ruc: string | null;
    address: string | null;
    environment: 'BETA' | 'PRODUCCION';
    logoSvg?: string;
    logoBuffer?: Buffer | null;
  };
  customer: {
    name: string;
    document: string | null;
    documentType: ClienteTipoDocumento;
    address: string | null;
  };
  type: VentaTipoComprobante;
  series: string;
  number: number;
  issuedAt: Date;
  sunatStatus: SunatEstado;
  sunatCode: string | null;
  items: Array<{
    description: string;
    quantity: Prisma.Decimal;
    unitPrice: Prisma.Decimal;
    total: Prisma.Decimal;
  }>;
  baseAmount: Prisma.Decimal;
  exemptAmount?: Prisma.Decimal;
  unaffectedAmount?: Prisma.Decimal;
  igv: Prisma.Decimal;
  igvPercent: Prisma.Decimal;
  total: Prisma.Decimal;
  paymentLabel: string;
  observations?: string | null;
};

const MM = 72 / 25.4;
const TICKET_WIDTH = 80 * MM;
const PAGE_MARGIN = 14 * MM;
const BORDER = '#8b8b8b';
const LIGHT_BORDER = '#b8b8b8';
const PINK = '#d4145a';

const documentLabels: Record<VentaTipoComprobante, string> = {
  nota_venta: 'NOTA DE VENTA',
  boleta: 'BOLETA DE VENTA ELECTRONICA',
  factura: 'FACTURA ELECTRONICA',
  guia_remision: 'GUIA DE REMISION',
  nota_credito_factura: 'NOTA DE CREDITO ELECTRONICA',
  nota_credito_boleta: 'NOTA DE CREDITO DE BOLETA ELECTRONICA',
};

function isElectronicFiscalType(type: VentaTipoComprobante) {
  return isElectronicSaleType(type) || isCreditNoteType(type);
}

@Injectable()
export class SalesPdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly localPdfLogoStorageService: LocalPdfLogoStorageService,
  ) {}

  async generateSalePdf(empresaId: bigint, publicId: string) {
    const sale = await this.findSale(empresaId, publicId);
    const assets = await this.buildAssets(sale);

    return this.createPdf(
      {
        size: 'A4',
        margins: {
          top: PAGE_MARGIN,
          right: PAGE_MARGIN,
          bottom: PAGE_MARGIN,
          left: PAGE_MARGIN,
        },
        info: { Title: `Venta ${sale.correlativo}` },
      },
      (doc) => this.renderSalePdf(doc, sale, assets),
    );
  }

  async generateSaleTicketPdf(empresaId: bigint, publicId: string) {
    const sale = await this.findSale(empresaId, publicId);
    const assets = await this.buildAssets(sale);
    const height = this.measureTicketHeight(sale, assets);

    return this.createPdf(
      {
        size: [TICKET_WIDTH, height],
        margin: 0,
        info: { Title: `Ticket ${sale.correlativo}` },
      },
      (doc) => this.renderTicket(doc, sale, assets),
    );
  }

  async generateCommercialDocumentPdf(input: CommercialDocumentPdfInput) {
    const sale = {
      empresa: {
        id: 0n,
        nombreComercial: input.issuer.tradeName,
        razonSocial: input.issuer.name,
        ruc: input.issuer.ruc,
        direccion: input.issuer.address,
        logoUrl: null,
        logoPdfUrl: null,
        sunatConfig: { ambiente: input.issuer.environment },
      },
      sucursal: null,
      cliente: {
        nombre: input.customer.name,
        razonSocial: input.customer.name,
        tipoDocumento: input.customer.documentType,
        numeroDocumento: input.customer.document,
        direccion: input.customer.address,
      },
      detalles: input.items.map((item) => ({
        descripcion: item.description,
        cantidad: item.quantity,
        unidadMedidaCodigo: 'NIU',
        precioUnitario: item.unitPrice,
        total: item.total,
        productoVariante: {
          sku: null,
          producto: { nombre: item.description },
          productoColor: { color: { nombre: '' } },
          talla: { nombre: '' },
        },
      })),
      pagos: [
        {
          monto: input.total,
          metodoPago: { nombre: input.paymentLabel },
        },
      ],
      tipoComprobante: input.type,
      correlativo: `${input.series}-${String(input.number).padStart(8, '0')}`,
      serie: input.series,
      numero: input.number,
      createdAt: input.issuedAt,
      sunatCodigo: input.sunatCode,
      sunatHash: null,
      sunatEstado: input.sunatStatus,
      descuentoMonto: new Prisma.Decimal(0),
      opGravadas: input.baseAmount,
      opExoneradas: input.exemptAmount ?? new Prisma.Decimal(0),
      opInafectas: input.unaffectedAmount ?? new Prisma.Decimal(0),
      igvPorcentaje: input.igvPercent,
      igvMonto: input.igv,
      subtotal: input.total,
      total: input.total,
      observaciones: input.observations ?? null,
    } as unknown as SaleForPdf;
    const electronic = isElectronicFiscalType(input.type);
    const [logo, qr] = await Promise.all([
      input.issuer.logoBuffer
        ? Promise.resolve(input.issuer.logoBuffer)
        : input.issuer.logoSvg
          ? sharp(Buffer.from(input.issuer.logoSvg)).png().toBuffer()
          : Promise.resolve(null),
      electronic ? this.buildQrBuffer(sale) : Promise.resolve(null),
    ]);

    return this.createPdf(
      {
        size: 'A4',
        margins: {
          top: PAGE_MARGIN,
          right: PAGE_MARGIN,
          bottom: PAGE_MARGIN,
          left: PAGE_MARGIN,
        },
        info: { Title: `Comprobante ${sale.correlativo}` },
      },
      (doc) => this.renderSalePdf(doc, sale, { logo, qr }),
    );
  }

  private async findSale(empresaId: bigint, publicId: string) {
    const sale = await this.prisma.venta.findFirst({
      where: { empresaId, publicId },
      include: salePdfInclude,
    });

    if (!sale) {
      throw new NotFoundException('Venta no encontrada');
    }

    return sale;
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

  private renderSalePdf(
    doc: PDFKit.PDFDocument,
    sale: SaleForPdf,
    assets: PdfAssets,
  ) {
    const fonts = this.registerFonts(doc);
    const electronicSale = isElectronicFiscalType(sale.tipoComprobante);
    const ambiente = sale.empresa.sunatConfig?.ambiente ?? 'BETA';
    const isBeta = electronicSale && ambiente === 'BETA';
    const left = doc.page.margins.left;
    const contentWidth =
      doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const empresaNombre = this.companyName(sale);
    const empresaDireccion = this.companyAddress(sale);

    doc.fillColor('#050505').font(fonts.regular).fontSize(9);

    if (isBeta) {
      const contentStartY = doc.y;
      const centerX = doc.page.width / 2;
      const centerY = doc.page.height / 2;
      doc
        .save()
        .fillColor(PINK)
        .fillOpacity(0.14)
        .font(fonts.extraBold)
        .fontSize(48)
        .rotate(-45, { origin: [centerX, centerY] })
        .text('SIN VALOR LEGAL', 45, centerY - 30, {
          width: doc.page.width - 90,
          align: 'center',
          lineBreak: false,
        })
        .restore();
      doc.y = contentStartY;
    }

    const headerTop = doc.y;
    const documentWidth = 235;
    const brandWidth = contentWidth - documentWidth - 22;

    if (assets.logo) {
      doc.image(assets.logo, left, headerTop, {
        fit: [120, 62],
      });
    } else {
      doc
        .roundedRect(left, headerTop, Math.min(205, brandWidth), 55, 6)
        .strokeColor(BORDER)
        .stroke()
        .font(fonts.bold)
        .fontSize(13)
        .text(empresaNombre, left + 10, headerTop + 17, {
          width: Math.min(185, brandWidth - 20),
          align: 'center',
        });
    }

    const companyTextY = assets.logo ? headerTop + 67 : headerTop + 61;
    doc
      .font(fonts.bold)
      .fontSize(10)
      .text(empresaNombre, left, companyTextY, { width: brandWidth });
    if (empresaDireccion) {
      doc
        .font(fonts.regular)
        .fontSize(8.5)
        .text(empresaDireccion, left, doc.y + 2, { width: brandWidth });
    }
    if (isBeta) {
      const betaY = doc.y + 7;
      doc
        .roundedRect(left, betaY, 86, 19, 9)
        .fillAndStroke('#fff0f5', '#f5a6c2')
        .fillColor(PINK)
        .font(fonts.bold)
        .fontSize(7.5)
        .text('AMBIENTE BETA', left, betaY + 6, {
          width: 86,
          align: 'center',
          lineBreak: false,
        })
        .fillColor('#050505');
    }

    const documentX = left + contentWidth - documentWidth;
    doc
      .roundedRect(documentX, headerTop, documentWidth, 96, 6)
      .strokeColor(BORDER)
      .stroke();
    const documentLines = [
      sale.empresa.ruc ? `R.U.C. Nro ${sale.empresa.ruc}` : '',
      documentLabels[sale.tipoComprobante],
      sale.correlativo,
    ].filter(Boolean);
    doc
      .font(fonts.bold)
      .fontSize(12)
      .text(documentLines.join('\n'), documentX + 12, headerTop + 22, {
        width: documentWidth - 24,
        align: 'center',
        lineGap: 5,
      });

    doc.y = headerTop + 112;
    this.drawCustomerBox(doc, sale, fonts, left, contentWidth, electronicSale);
    this.drawSaleTable(doc, sale, fonts, left, contentWidth, electronicSale);
    this.ensureA4Space(doc, electronicSale ? 125 : 95);
    this.drawSaleSummary(
      doc,
      sale,
      assets,
      fonts,
      left,
      contentWidth,
      electronicSale,
    );

    if (sale.observaciones) {
      this.ensureA4Space(doc, 55);
      this.drawLabeledBox(
        doc,
        'OBSERVACIONES:',
        sale.observaciones,
        fonts,
        left,
        contentWidth,
      );
    }

    this.ensureA4Space(doc, 55);
    this.drawLabeledBox(
      doc,
      'Forma de pago:',
      this.buildPaymentLabel(sale),
      fonts,
      left,
      contentWidth,
    );

    const legalNote = this.buildLegalNote(sale, ambiente, electronicSale);
    this.ensureA4Space(doc, 35);
    doc
      .font(fonts.regular)
      .fontSize(8)
      .text(legalNote, left, doc.y + 8, {
        width: contentWidth,
        align: 'center',
      });
  }

  private drawCustomerBox(
    doc: PDFKit.PDFDocument,
    sale: SaleForPdf,
    fonts: PdfFonts,
    x: number,
    width: number,
    electronicSale: boolean,
  ) {
    const clienteNombre =
      sale.cliente?.razonSocial || sale.cliente?.nombre || 'CLIENTE GENERAL';
    const clienteDocumento = sale.cliente?.numeroDocumento
      ? `${this.getClientDocumentLabel(sale.cliente.tipoDocumento)}: ${sale.cliente.numeroDocumento}`
      : '';
    const rows = [
      ['Fecha emision', this.formatDate(sale.createdAt)],
      ['Senor(es)', clienteNombre],
      ...(clienteDocumento ? [['Documento', clienteDocumento]] : []),
      ...(sale.cliente?.direccion
        ? [['Direccion', sale.cliente.direccion]]
        : []),
      ...(electronicSale && sale.sunatCodigo
        ? [['Codigo SUNAT', sale.sunatCodigo]]
        : []),
    ];
    const rowWidth = width - 24;
    const valueWidth = rowWidth - 100;
    let height = 18;

    for (const [, value] of rows) {
      height += Math.max(
        14,
        doc.font(fonts.regular).fontSize(8.5).heightOfString(value, {
          width: valueWidth,
        }),
      );
    }

    const startY = doc.y;
    doc.roundedRect(x, startY, width, height, 6).strokeColor(BORDER).stroke();
    let y = startY + 9;
    for (const [label, value] of rows) {
      const rowHeight = Math.max(
        14,
        doc.font(fonts.regular).fontSize(8.5).heightOfString(value, {
          width: valueWidth,
        }),
      );
      doc
        .font(fonts.bold)
        .text(label, x + 10, y, { width: 82, lineBreak: false })
        .font(fonts.regular)
        .text(`: ${value}`, x + 92, y, { width: valueWidth });
      y += rowHeight;
    }
    doc.y = startY + height + 12;
  }

  private drawSaleTable(
    doc: PDFKit.PDFDocument,
    sale: SaleForPdf,
    fonts: PdfFonts,
    x: number,
    width: number,
    electronicSale: boolean,
  ) {
    const fixed = [34, 44, 58, 54, 58];
    const columns = [
      fixed[0],
      fixed[1],
      fixed[2],
      width - 248,
      fixed[3],
      fixed[4],
    ];
    const headers = [
      'Cant.',
      'Unidad',
      'Codigo',
      'Descripcion',
      'P.U.',
      'Total',
    ];
    const drawHeader = () => {
      const y = doc.y;
      doc.rect(x, y, width, 24).strokeColor(BORDER).stroke();
      let columnX = x;
      headers.forEach((header, index) => {
        if (index > 0) {
          doc
            .moveTo(columnX, y)
            .lineTo(columnX, y + 24)
            .strokeColor(LIGHT_BORDER)
            .stroke();
        }
        doc
          .font(fonts.bold)
          .fontSize(7.8)
          .text(header, columnX + 4, y + 8, {
            width: columns[index] - 8,
            align: index === 0 ? 'center' : index >= 4 ? 'right' : 'left',
            lineBreak: false,
          });
        columnX += columns[index];
      });
      doc.y = y + 24;
    };

    drawHeader();
    for (const item of sale.detalles) {
      const description = this.itemDescription(item);
      doc.font(fonts.regular).fontSize(7.8);
      const descriptionHeight = doc.heightOfString(description, {
        width: columns[3] - 8,
      });
      const rowHeight = Math.max(23, descriptionHeight + 10);

      if (doc.y + rowHeight > doc.page.height - doc.page.margins.bottom - 12) {
        doc.addPage();
        drawHeader();
      }

      const y = doc.y;
      doc.rect(x, y, width, rowHeight).strokeColor(LIGHT_BORDER).stroke();
      const values = [
        String(item.cantidad),
        item.unidadMedidaCodigo || 'NIU',
        item.productoVariante.sku || '',
        description,
        this.money(item.precioUnitario),
        this.money(item.total),
      ];
      let columnX = x;
      values.forEach((value, index) => {
        if (index > 0) {
          doc
            .moveTo(columnX, y)
            .lineTo(columnX, y + rowHeight)
            .strokeColor(LIGHT_BORDER)
            .stroke();
        }
        doc
          .font(fonts.regular)
          .fontSize(7.8)
          .text(value, columnX + 4, y + 7, {
            width: columns[index] - 8,
            align: index === 0 ? 'center' : index >= 4 ? 'right' : 'left',
          });
        columnX += columns[index];
      });
      doc.y = y + rowHeight;
    }

    const totals = this.saleTotals(sale, electronicSale);
    for (const [label, value, grand] of totals) {
      if (doc.y + 18 > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
      }
      const y = doc.y;
      const valueWidth = columns[5];
      const labelWidth = 92;
      const labelX = x + width - labelWidth - valueWidth;
      doc
        .font(grand ? fonts.extraBold : fonts.bold)
        .fontSize(grand ? 9 : 8)
        .text(label, labelX, y + 5, {
          width: labelWidth - 5,
          align: 'right',
          lineBreak: false,
        })
        .text(value, labelX + labelWidth, y + 5, {
          width: valueWidth - 4,
          align: 'right',
          lineBreak: false,
        });
      doc.y = y + 18;
    }
    doc.y += 12;
  }

  private drawSaleSummary(
    doc: PDFKit.PDFDocument,
    sale: SaleForPdf,
    assets: PdfAssets,
    fonts: PdfFonts,
    x: number,
    width: number,
    electronicSale: boolean,
  ) {
    const totalItems = sale.detalles.reduce(
      (sum, item) => sum + item.cantidad,
      0,
    );
    const qrWidth = electronicSale ? 105 : 0;
    const gap = electronicSale ? 12 : 0;
    const summaryWidth = width - qrWidth - gap;
    const summaryText = [
      `IMPORTE EN LETRAS: ${this.amountToWords(sale.total)}`,
      `RESUMEN: ${totalItems} unidad(es) vendida(s)`,
      ...(electronicSale
        ? [
            `HASH: ${sale.sunatHash || 'Pendiente de emision SUNAT'}`,
            `ESTADO SUNAT: ${this.getSunatStatusLabel(sale.sunatEstado)}`,
          ]
        : []),
    ];
    const summaryHeight = Math.max(
      86,
      doc
        .font(fonts.regular)
        .fontSize(8)
        .heightOfString(summaryText.join('\n'), {
          width: summaryWidth - 20,
          lineGap: 4,
        }) + 20,
    );
    const y = doc.y;

    doc
      .roundedRect(x, y, summaryWidth, summaryHeight, 6)
      .strokeColor(BORDER)
      .stroke()
      .font(fonts.regular)
      .fontSize(8)
      .text(summaryText.join('\n'), x + 10, y + 10, {
        width: summaryWidth - 20,
        lineGap: 4,
      });

    if (electronicSale) {
      const qrX = x + summaryWidth + gap;
      doc
        .roundedRect(qrX, y, qrWidth, summaryHeight, 6)
        .strokeColor(BORDER)
        .stroke();
      if (assets.qr) {
        const size = Math.min(76, summaryHeight - 14);
        doc.image(assets.qr, qrX + (qrWidth - size) / 2, y + 7, {
          width: size,
          height: size,
        });
      } else {
        doc
          .font(fonts.regular)
          .fontSize(8)
          .text('QR pendiente', qrX, y + summaryHeight / 2 - 4, {
            width: qrWidth,
            align: 'center',
          });
      }
    }
    doc.y = y + summaryHeight + 12;
  }

  private drawLabeledBox(
    doc: PDFKit.PDFDocument,
    label: string,
    value: string,
    fonts: PdfFonts,
    x: number,
    width: number,
  ) {
    const textHeight = doc
      .font(fonts.regular)
      .fontSize(8.5)
      .heightOfString(value, { width: width - 20 });
    const height = Math.max(38, textHeight + 25);
    const y = doc.y;
    doc.roundedRect(x, y, width, height, 6).strokeColor(BORDER).stroke();
    doc
      .font(fonts.bold)
      .fontSize(8.5)
      .text(label, x + 10, y + 9, { continued: true })
      .font(fonts.regular)
      .text(` ${value}`, { width: width - 20 });
    doc.y = y + height + 10;
  }

  private ensureA4Space(doc: PDFKit.PDFDocument, requiredHeight: number) {
    if (doc.y + requiredHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
    }
  }

  private measureTicketHeight(sale: SaleForPdf, assets: PdfAssets) {
    const doc = new PDFDocument({
      size: [TICKET_WIDTH, 10000],
      margin: 0,
    });
    doc.on('data', () => undefined);
    const height = this.renderTicket(doc, sale, assets);
    doc.end();
    return Math.max(195, Math.ceil(height));
  }

  private renderTicket(
    doc: PDFKit.PDFDocument,
    sale: SaleForPdf,
    assets: PdfAssets,
  ) {
    const fonts = this.registerFonts(doc);
    const electronicSale = isElectronicSaleType(sale.tipoComprobante);
    const ambiente = sale.empresa.sunatConfig?.ambiente ?? 'BETA';
    const isBeta = electronicSale && ambiente === 'BETA';
    const padding = 8;
    const width = TICKET_WIDTH - padding * 2;
    const empresaNombre = this.companyName(sale);
    const empresaDireccion = this.companyAddress(sale);
    const clienteNombre =
      sale.cliente?.razonSocial || sale.cliente?.nombre || 'CLIENTE GENERAL';
    const clienteDocumento = sale.cliente?.numeroDocumento
      ? `${this.getClientDocumentLabel(sale.cliente.tipoDocumento)}: ${sale.cliente.numeroDocumento}`
      : '-';

    doc.fillColor('#050505').font(fonts.regular).fontSize(7.5);
    doc.y = 8;

    if (assets.logo) {
      doc.image(assets.logo, (TICKET_WIDTH - 88) / 2, doc.y, {
        fit: [88, 36],
        align: 'center',
        valign: 'center',
      });
      doc.y += 40;
    }

    doc.font(fonts.bold).fontSize(8.5).text(empresaNombre, padding, doc.y, {
      width,
      align: 'center',
    });
    if (sale.empresa.ruc) {
      doc
        .font(fonts.bold)
        .fontSize(7.5)
        .text(`RUC: ${sale.empresa.ruc}`, padding, doc.y + 2, {
          width,
          align: 'center',
        });
    }
    if (empresaDireccion) {
      doc
        .font(fonts.regular)
        .fontSize(6.8)
        .text(empresaDireccion, padding, doc.y + 2, {
          width,
          align: 'center',
        });
    }
    doc
      .font(fonts.bold)
      .fontSize(8.5)
      .text(documentLabels[sale.tipoComprobante], padding, doc.y + 6, {
        width,
        align: 'center',
      })
      .font(fonts.extraBold)
      .fontSize(10)
      .text(sale.correlativo, padding, doc.y + 2, {
        width,
        align: 'center',
      });
    if (isBeta) {
      doc
        .fillColor(PINK)
        .font(fonts.bold)
        .fontSize(7)
        .text('AMBIENTE BETA - SIN VALOR LEGAL', padding, doc.y + 4, {
          width,
          align: 'center',
        })
        .fillColor('#050505');
    }

    this.ticketSeparator(doc, padding, width);
    this.ticketRow(
      doc,
      'Fecha',
      this.formatDateTime(sale.createdAt),
      fonts,
      padding,
      width,
    );
    this.ticketRow(doc, 'Cliente', clienteNombre, fonts, padding, width);
    this.ticketRow(doc, 'Documento', clienteDocumento, fonts, padding, width);
    if (sale.cliente?.direccion) {
      this.ticketRow(
        doc,
        'Direccion',
        sale.cliente.direccion,
        fonts,
        padding,
        width,
      );
    }

    this.ticketSeparator(doc, padding, width);
    this.ticketTableHeader(doc, fonts, padding, width);
    for (const item of sale.detalles) {
      this.ticketItem(doc, item, fonts, padding, width);
    }

    this.ticketSeparator(doc, padding, width);
    for (const [label, value, grand] of this.saleTotals(sale, electronicSale)) {
      this.ticketTotal(doc, label, value, fonts, padding, width, grand);
    }

    doc.y += 4;
    this.ticketLabeledText(
      doc,
      'SON:',
      this.amountToWords(sale.total),
      fonts,
      padding,
      width,
    );
    this.ticketLabeledText(
      doc,
      'Forma de pago:',
      this.buildPaymentLabel(sale),
      fonts,
      padding,
      width,
    );

    if (electronicSale) {
      this.ticketSeparator(doc, padding, width);
      if (assets.qr) {
        const qrSize = 68;
        doc.image(assets.qr, (TICKET_WIDTH - qrSize) / 2, doc.y, {
          width: qrSize,
          height: qrSize,
        });
        doc.y += qrSize + 4;
      }
      doc
        .font(fonts.regular)
        .fontSize(6.8)
        .text(
          `SUNAT: ${this.getSunatStatusLabel(sale.sunatEstado)}`,
          padding,
          doc.y,
          { width, align: 'center' },
        );
      this.ticketLabeledText(
        doc,
        'HASH:',
        sale.sunatHash || 'Pendiente',
        fonts,
        padding,
        width,
        6.3,
      );
    }

    if (sale.observaciones) {
      this.ticketSeparator(doc, padding, width);
      this.ticketLabeledText(
        doc,
        'OBS:',
        sale.observaciones,
        fonts,
        padding,
        width,
        6.8,
      );
    }

    this.ticketSeparator(doc, padding, width);
    doc
      .font(fonts.regular)
      .fontSize(6.5)
      .text(
        this.buildLegalNote(sale, ambiente, electronicSale),
        padding,
        doc.y,
        { width, align: 'center' },
      );

    return doc.y + 12;
  }

  private ticketSeparator(doc: PDFKit.PDFDocument, x: number, width: number) {
    doc.y += 6;
    doc
      .save()
      .dash(2, { space: 2 })
      .moveTo(x, doc.y)
      .lineTo(x + width, doc.y)
      .strokeColor('#777777')
      .stroke()
      .undash()
      .restore();
    doc.y += 6;
  }

  private ticketRow(
    doc: PDFKit.PDFDocument,
    label: string,
    value: string,
    fonts: PdfFonts,
    x: number,
    width: number,
  ) {
    const labelWidth = 55;
    const valueWidth = width - labelWidth;
    const height = Math.max(
      11,
      doc.font(fonts.regular).fontSize(7.2).heightOfString(value, {
        width: valueWidth,
      }),
    );
    const y = doc.y;
    doc
      .font(fonts.bold)
      .fontSize(7.2)
      .text(label, x, y, { width: labelWidth, lineBreak: false })
      .font(fonts.regular)
      .text(value, x + labelWidth, y, { width: valueWidth });
    doc.y = y + height + 1;
  }

  private ticketTableHeader(
    doc: PDFKit.PDFDocument,
    fonts: PdfFonts,
    x: number,
    width: number,
  ) {
    const y = doc.y;
    doc
      .font(fonts.bold)
      .fontSize(6.8)
      .text('CANT', x, y, { width: 26, align: 'center', lineBreak: false })
      .text('DETALLE', x + 28, y, {
        width: width - 80,
        lineBreak: false,
      })
      .text('TOTAL', x + width - 50, y, {
        width: 50,
        align: 'right',
        lineBreak: false,
      });
    doc.y = y + 13;
  }

  private ticketItem(
    doc: PDFKit.PDFDocument,
    item: SaleForPdf['detalles'][number],
    fonts: PdfFonts,
    x: number,
    width: number,
  ) {
    const description = this.itemDescription(item);
    const meta = [
      item.productoVariante.sku ? `COD: ${item.productoVariante.sku}` : '',
      `UND: ${item.unidadMedidaCodigo || 'NIU'}`,
      `P.U.: S/ ${this.money(item.precioUnitario)}`,
    ]
      .filter(Boolean)
      .join(' | ');
    const detailX = x + 28;
    const detailWidth = width - 82;
    const descriptionHeight = doc
      .font(fonts.bold)
      .fontSize(7)
      .heightOfString(description, { width: detailWidth });
    const metaHeight = doc
      .font(fonts.regular)
      .fontSize(6.2)
      .heightOfString(meta, { width: detailWidth });
    const height = Math.max(17, descriptionHeight + metaHeight + 4);
    const y = doc.y;

    doc
      .font(fonts.regular)
      .fontSize(7)
      .text(String(item.cantidad), x, y, {
        width: 26,
        align: 'center',
        lineBreak: false,
      })
      .font(fonts.bold)
      .text(description, detailX, y, { width: detailWidth })
      .font(fonts.regular)
      .fontSize(6.2)
      .fillColor('#333333')
      .text(meta, detailX, y + descriptionHeight + 1, {
        width: detailWidth,
      })
      .fillColor('#050505')
      .fontSize(7)
      .text(`S/ ${this.money(item.total)}`, x + width - 50, y, {
        width: 50,
        align: 'right',
        lineBreak: false,
      });
    doc.y = y + height + 2;
  }

  private ticketTotal(
    doc: PDFKit.PDFDocument,
    label: string,
    value: string,
    fonts: PdfFonts,
    x: number,
    width: number,
    grand: boolean,
  ) {
    const y = doc.y;
    doc
      .font(grand ? fonts.extraBold : fonts.bold)
      .fontSize(grand ? 9 : 7.2)
      .text(label, x, y, {
        width: width - 62,
        align: 'right',
        lineBreak: false,
      })
      .text(value, x + width - 60, y, {
        width: 60,
        align: 'right',
        lineBreak: false,
      });
    doc.y = y + (grand ? 13 : 11);
  }

  private ticketLabeledText(
    doc: PDFKit.PDFDocument,
    label: string,
    value: string,
    fonts: PdfFonts,
    x: number,
    width: number,
    size = 6.8,
  ) {
    doc
      .font(fonts.bold)
      .fontSize(size)
      .text(label, x, doc.y, { continued: true })
      .font(fonts.regular)
      .text(` ${value}`, { width });
    doc.y += 3;
  }

  private saleTotals(sale: SaleForPdf, electronicSale: boolean) {
    const rows: Array<[string, string, boolean]> = [];

    if (sale.descuentoMonto.gt(0)) {
      rows.push([
        'DESCUENTO',
        `- S/ ${this.money(sale.descuentoMonto)}`,
        false,
      ]);
    }
    if (electronicSale) {
      rows.push(['OP. GRAVADAS', `S/ ${this.money(sale.opGravadas)}`, false]);
      if (sale.opExoneradas.gt(0)) {
        rows.push([
          'OP. EXONERADAS',
          `S/ ${this.money(sale.opExoneradas)}`,
          false,
        ]);
      }
      if (sale.opInafectas.gt(0)) {
        rows.push([
          'OP. INAFECTAS',
          `S/ ${this.money(sale.opInafectas)}`,
          false,
        ]);
      }
      rows.push([
        `IGV (${this.money(sale.igvPorcentaje)}%)`,
        `S/ ${this.money(sale.igvMonto)}`,
        false,
      ]);
    } else {
      rows.push(['SUBTOTAL', `S/ ${this.money(sale.subtotal)}`, false]);
    }
    rows.push(['IMPORTE TOTAL', `S/ ${this.money(sale.total)}`, true]);
    return rows;
  }

  private itemDescription(item: SaleForPdf['detalles'][number]) {
    const variant = item.productoVariante;
    if (variant.producto.tipo === ProductoTipo.normal) {
      return item.descripcion || variant.producto.nombre;
    }
    return (
      item.descripcion ||
      [
        variant.producto.nombre,
        variant.productoColor.color.nombre,
        variant.talla.nombre ? `Talla ${variant.talla.nombre}` : '',
      ]
        .filter(Boolean)
        .join(' - ')
    );
  }

  private companyName(sale: SaleForPdf) {
    return sale.empresa.razonSocial || sale.empresa.nombreComercial || '';
  }

  private companyAddress(sale: SaleForPdf) {
    return (
      sale.empresa.direccion ||
      sale.sucursal?.direccion ||
      [sale.sucursal?.distrito, sale.sucursal?.ubigeo]
        .filter(Boolean)
        .join(' - ')
    );
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

  private async buildAssets(sale: SaleForPdf): Promise<PdfAssets> {
    const [logo, qr] = await Promise.all([
      this.buildLogoBuffer(sale),
      this.buildQrBuffer(sale),
    ]);
    return { logo, qr };
  }

  private async buildLogoBuffer(sale: SaleForPdf) {
    const dataUri = await this.resolveCompanyLogoDataUri(sale);
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

  private buildQrBuffer(sale: SaleForPdf) {
    if (!isElectronicFiscalType(sale.tipoComprobante) || !sale.empresa.ruc) {
      return null;
    }

    const content = buildQrContent({
      ruc: sale.empresa.ruc,
      tipoComprobante: sale.tipoComprobante,
      serie: sale.serie,
      numero: sale.numero,
      igv: this.money(sale.igvMonto),
      total: this.money(sale.total),
      fecha: sale.createdAt,
      clienteTipoDocumento: sale.cliente?.tipoDocumento,
      clienteNumeroDocumento: sale.cliente?.numeroDocumento,
    });

    return QRCode.toBuffer(content, {
      type: 'png',
      errorCorrectionLevel: 'M',
      margin: 1,
      scale: 5,
    });
  }

  private buildLegalNote(
    sale: SaleForPdf,
    ambiente: 'BETA' | 'PRODUCCION',
    electronicSale: boolean,
  ) {
    if (!electronicSale) {
      return `Representacion impresa de ${documentLabels[sale.tipoComprobante].toLowerCase()}.`;
    }
    if (ambiente === 'BETA') {
      return 'Comprobante emitido en ambiente BETA. No tiene valor legal.';
    }
    return `Representacion impresa de ${documentLabels[sale.tipoComprobante].toLowerCase()}. Consulte su documento en https://consulta.sunat.gob.pe`;
  }

  private getSunatStatusLabel(status: SunatEstado) {
    const labels: Record<SunatEstado, string> = {
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
    return labels[status];
  }

  private async resolveCompanyLogoDataUri(sale: SaleForPdf) {
    const localLogo = await this.localPdfLogoStorageService.resolveToDataUri(
      sale.empresa.logoPdfUrl,
    );
    if (localLogo) {
      return localLogo;
    }

    if (sale.empresa.logoUrl) {
      const stored =
        await this.localPdfLogoStorageService.saveCompanyLogoFromUrl({
          empresaId: sale.empresa.id,
          imageUrl: sale.empresa.logoUrl,
          previousUrl: sale.empresa.logoPdfUrl,
        });
      if (stored) {
        await this.prisma.empresa.update({
          where: { id: sale.empresa.id },
          data: { logoPdfUrl: stored.url },
        });
        return this.localPdfLogoStorageService.resolveToDataUri(stored.url);
      }
    }

    return this.resolveRemoteImageDataUri(sale.empresa.logoUrl);
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
    return 'image/png';
  }

  private buildPaymentLabel(sale: SaleForPdf) {
    if (!sale.pagos.length) {
      return 'Pendiente';
    }
    return sale.pagos
      .map(
        (payment) =>
          `${payment.metodoPago.nombre} S/ ${this.money(payment.monto)}`,
      )
      .join(' / ');
  }

  private getClientDocumentLabel(tipoDocumento: string) {
    if (tipoDocumento === 'ruc') return 'RUC';
    if (tipoDocumento === 'dni') return 'DNI';
    return 'DOC';
  }

  private formatDate(date: Date) {
    return new Intl.DateTimeFormat('es-PE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(date);
  }

  private formatDateTime(date: Date) {
    return new Intl.DateTimeFormat('es-PE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  private money(value: Prisma.Decimal) {
    return value.toFixed(2);
  }

  private amountToWords(value: Prisma.Decimal) {
    const fixed = value.toFixed(2);
    const [integerPart, decimalPart] = fixed.split('.');
    return `${this.numberToSpanish(Number(integerPart)).toUpperCase()} CON ${decimalPart}/100 SOLES`;
  }

  private numberToSpanish(value: number): string {
    if (value === 0) return 'cero';
    if (value < 0) return `menos ${this.numberToSpanish(Math.abs(value))}`;

    const units = [
      '',
      'uno',
      'dos',
      'tres',
      'cuatro',
      'cinco',
      'seis',
      'siete',
      'ocho',
      'nueve',
      'diez',
      'once',
      'doce',
      'trece',
      'catorce',
      'quince',
      'dieciseis',
      'diecisiete',
      'dieciocho',
      'diecinueve',
      'veinte',
    ];
    const tens = [
      '',
      '',
      'veinti',
      'treinta',
      'cuarenta',
      'cincuenta',
      'sesenta',
      'setenta',
      'ochenta',
      'noventa',
    ];
    const hundreds = [
      '',
      'ciento',
      'doscientos',
      'trescientos',
      'cuatrocientos',
      'quinientos',
      'seiscientos',
      'setecientos',
      'ochocientos',
      'novecientos',
    ];

    if (value <= 20) return units[value];
    if (value < 30) return `veinti${units[value - 20]}`;
    if (value < 100) {
      const ten = Math.floor(value / 10);
      const unit = value % 10;
      return unit ? `${tens[ten]} y ${units[unit]}` : tens[ten];
    }
    if (value === 100) return 'cien';
    if (value < 1000) {
      const hundred = Math.floor(value / 100);
      const rest = value % 100;
      return rest
        ? `${hundreds[hundred]} ${this.numberToSpanish(rest)}`
        : hundreds[hundred];
    }
    if (value < 1000000) {
      const thousands = Math.floor(value / 1000);
      const rest = value % 1000;
      const thousandText =
        thousands === 1 ? 'mil' : `${this.numberToSpanish(thousands)} mil`;
      return rest
        ? `${thousandText} ${this.numberToSpanish(rest)}`
        : thousandText;
    }

    const millions = Math.floor(value / 1000000);
    const rest = value % 1000000;
    const millionText =
      millions === 1
        ? 'un millon'
        : `${this.numberToSpanish(millions)} millones`;
    return rest ? `${millionText} ${this.numberToSpanish(rest)}` : millionText;
  }
}
