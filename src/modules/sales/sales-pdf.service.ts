import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, VentaTipoComprobante } from '@prisma/client';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import puppeteer from 'puppeteer';
import { PrismaService } from '../../prisma/prisma.service';
import { LocalPdfLogoStorageService } from '../storage/local-pdf-logo-storage.service';

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
          producto: { select: { nombre: true } },
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

const documentLabels: Record<VentaTipoComprobante, string> = {
  nota_venta: 'NOTA DE VENTA',
  boleta: 'BOLETA DE VENTA',
  factura: 'FACTURA',
};

@Injectable()
export class SalesPdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly localPdfLogoStorageService: LocalPdfLogoStorageService,
  ) {}

  async generateSalePdf(empresaId: bigint, publicId: string) {
    const sale = await this.prisma.venta.findFirst({
      where: { empresaId, publicId },
      include: salePdfInclude,
    });

    if (!sale) {
      throw new NotFoundException('Venta no encontrada');
    }

    const html = await this.buildHtml(sale);
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      return await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: '14mm',
          right: '14mm',
          bottom: '14mm',
          left: '14mm',
        },
      });
    } finally {
      await browser.close();
    }
  }

  private async buildHtml(sale: SaleForPdf) {
    const empresaNombre =
      sale.empresa.razonSocial || sale.empresa.nombreComercial || '';
    const empresaDireccion =
      sale.empresa.direccion ||
      sale.sucursal?.direccion ||
      [sale.sucursal?.distrito, sale.sucursal?.ubigeo]
        .filter(Boolean)
        .join(' - ');
    const clienteNombre =
      sale.cliente?.razonSocial || sale.cliente?.nombre || 'CLIENTE GENERAL';
    const clienteDocumento = sale.cliente?.numeroDocumento
      ? `${this.getClientDocumentLabel(sale.cliente.tipoDocumento)}: ${sale.cliente.numeroDocumento}`
      : '';
    const subtotal = sale.subtotal;
    const descuento = sale.descuentoMonto;
    const total = sale.total;
    const totalItems = sale.detalles.reduce(
      (sum, item) => sum + item.cantidad,
      0,
    );
    const paymentLabel = this.buildPaymentLabel(sale);
    const logoDataUri = await this.resolveCompanyLogoDataUri(sale);
    const logoHtml = logoDataUri
      ? `<img class="logo" src="${this.escapeAttribute(logoDataUri)}" alt="Logo" />`
      : `<div class="logo-fallback">${this.escapeHtml(empresaNombre)}</div>`;

    return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <style>
    ${this.buildFontFaces()}
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #050505;
      font-family: "CircularPDF", Arial, sans-serif;
      font-size: 11px;
      line-height: 1.35;
      background: #fff;
    }
    .page { width: 100%; }
    .header {
      display: grid;
      grid-template-columns: 1fr 380px;
      gap: 28px;
      align-items: start;
      margin-bottom: 14px;
    }
    .brand { min-height: 128px; }
    .logo {
      display: block;
      max-width: 142px;
      max-height: 104px;
      object-fit: contain;
      margin-bottom: 10px;
    }
    .logo-fallback {
      display: inline-flex;
      min-height: 72px;
      max-width: 230px;
      align-items: center;
      justify-content: center;
      margin-bottom: 12px;
      padding: 14px 18px;
      border: 1px solid #8b8b8b;
      border-radius: 10px;
      font-family: "CircularPDFBold", Arial, sans-serif;
      font-size: 16px;
      text-align: center;
    }
    .company-name {
      font-family: "CircularPDFBold", Arial, sans-serif;
      font-size: 12px;
      margin-bottom: 4px;
    }
    .company-meta { font-size: 11px; }
    .document-box {
      min-height: 126px;
      border: 1px solid #8b8b8b;
      border-radius: 7px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 18px;
      text-align: center;
      font-family: "CircularPDFBold", Arial, sans-serif;
      font-size: 15px;
      line-height: 1.45;
    }
    .customer-box {
      border: 1px solid #8b8b8b;
      border-radius: 7px;
      padding: 10px 12px;
      margin-bottom: 14px;
    }
    .row {
      display: grid;
      grid-template-columns: 120px 12px 1fr;
      gap: 4px;
      margin: 2px 0;
    }
    .label { font-family: "CircularPDFBold", Arial, sans-serif; }
    table {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      border: 1px solid #8b8b8b;
      border-radius: 7px;
      overflow: hidden;
      margin-bottom: 16px;
    }
    th, td {
      padding: 7px 8px;
      border-bottom: 1px solid #b8b8b8;
      vertical-align: top;
    }
    th {
      font-family: "CircularPDFBold", Arial, sans-serif;
      text-align: left;
      background: #fff;
    }
    tbody tr:last-child td { border-bottom: 1px solid #b8b8b8; }
    .center { text-align: center; }
    .right { text-align: right; }
    .totals-row td {
      border-bottom: none;
      padding-top: 4px;
      padding-bottom: 4px;
    }
    .totals-label {
      text-align: right;
      font-family: "CircularPDFBold", Arial, sans-serif;
    }
    .total-amount {
      font-family: "CircularPDFBold", Arial, sans-serif;
    }
    .box {
      border: 1px solid #8b8b8b;
      border-radius: 7px;
      padding: 10px 12px;
      margin-bottom: 14px;
      min-height: 46px;
    }
    .amount-words {
      min-height: 80px;
    }
    .footer-note {
      margin-top: 18px;
      text-align: center;
      font-size: 10px;
    }
  </style>
</head>
<body>
  <main class="page">
    <section class="header">
      <div class="brand">
        ${logoHtml}
        ${
          logoDataUri
            ? `<div class="company-name">${this.escapeHtml(empresaNombre)}</div>`
            : ''
        }
        ${
          empresaDireccion
            ? `<div class="company-meta">${this.escapeHtml(empresaDireccion)}</div>`
            : ''
        }
      </div>
      <div class="document-box">
        ${sale.empresa.ruc ? `<div>R.U.C. N° ${this.escapeHtml(sale.empresa.ruc)}</div>` : ''}
        <div>${documentLabels[sale.tipoComprobante]}</div>
        <div>${this.escapeHtml(sale.correlativo)}</div>
      </div>
    </section>

    <section class="customer-box">
      <div class="row"><div class="label">Fecha emisión</div><div>:</div><div>${this.formatDate(sale.createdAt)}</div></div>
      <div class="row"><div class="label">Señor(es)</div><div>:</div><div>${this.escapeHtml(clienteNombre)}</div></div>
      ${clienteDocumento ? `<div class="row"><div class="label">Documento</div><div>:</div><div>${this.escapeHtml(clienteDocumento)}</div></div>` : ''}
      ${sale.cliente?.direccion ? `<div class="row"><div class="label">Dirección</div><div>:</div><div>${this.escapeHtml(sale.cliente.direccion)}</div></div>` : ''}
    </section>

    <table>
      <thead>
        <tr>
          <th class="center" style="width: 58px;">Cant.</th>
          <th style="width: 76px;">Unidad</th>
          <th style="width: 88px;">Código</th>
          <th>Descripción</th>
          <th class="right" style="width: 82px;">P.U.</th>
          <th class="right" style="width: 82px;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${sale.detalles.map((item) => this.buildDetailRow(item)).join('')}
        <tr class="totals-row">
          <td colspan="4"></td>
          <td class="totals-label">SUBTOTAL</td>
          <td class="right">S/ ${this.money(subtotal)}</td>
        </tr>
        ${
          descuento.gt(0)
            ? `<tr class="totals-row"><td colspan="4"></td><td class="totals-label">DESCUENTO</td><td class="right">S/ ${this.money(descuento)}</td></tr>`
            : ''
        }
        <tr class="totals-row">
          <td colspan="4"></td>
          <td class="totals-label">IMPORTE TOTAL</td>
          <td class="right total-amount">S/ ${this.money(total)}</td>
        </tr>
      </tbody>
    </table>

    <section class="box amount-words">
      <div><span class="label">IMPORTE EN LETRAS:</span> ${this.escapeHtml(this.amountToWords(total))}</div>
      <div><span class="label">RESUMEN:</span> ${totalItems} unidad(es) vendida(s)</div>
    </section>

    ${
      sale.observaciones
        ? `<section class="box"><div class="label">OBSERVACIONES:</div><div>${this.escapeHtml(sale.observaciones)}</div></section>`
        : ''
    }

    <section class="box">
      <span class="label">Forma de pago:</span> ${this.escapeHtml(paymentLabel)}
    </section>

    <div class="footer-note">
      Representación impresa de ${this.escapeHtml(documentLabels[sale.tipoComprobante].toLowerCase())}.
    </div>
  </main>
</body>
</html>`;
  }

  private buildDetailRow(item: SaleForPdf['detalles'][number]) {
    const variant = item.productoVariante;
    const description = [
      variant.producto.nombre,
      variant.productoColor.color.nombre,
      variant.talla.nombre ? `Talla ${variant.talla.nombre}` : '',
    ]
      .filter(Boolean)
      .join(' - ');

    return `<tr>
      <td class="center">${item.cantidad}</td>
      <td>UNIDAD</td>
      <td>${this.escapeHtml(variant.sku || '')}</td>
      <td>${this.escapeHtml(description)}</td>
      <td class="right">${this.money(item.precioUnitario)}</td>
      <td class="right">${this.money(item.total)}</td>
    </tr>`;
  }

  private async resolveCompanyLogoDataUri(sale: SaleForPdf) {
    const localLogo = await this.localPdfLogoStorageService.resolveToDataUri(
      sale.empresa.logoPdfUrl,
    );

    if (localLogo) {
      return localLogo;
    }

    if (sale.empresa.logoUrl) {
      const stored = await this.localPdfLogoStorageService.saveCompanyLogoFromUrl(
        {
          empresaId: sale.empresa.id,
          imageUrl: sale.empresa.logoUrl,
          previousUrl: sale.empresa.logoPdfUrl,
        },
      );

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

  private buildFontFaces() {
    const fontDir = resolve(
      process.cwd(),
      '..',
      '..',
      'nobitex',
      'public',
      'font',
    );
    const regular = this.fontDataUri(
      resolve(fontDir, 'CircularXXSub-Regular.woff'),
    );
    const bold = this.fontDataUri(resolve(fontDir, 'CircularXXSub-Bold.woff'));
    const black = this.fontDataUri(
      resolve(fontDir, 'CircularXXSub-Black.woff'),
    );

    return `
      ${regular ? `@font-face { font-family: "CircularPDF"; src: url("${regular}") format("woff"); font-weight: 400; }` : ''}
      ${bold ? `@font-face { font-family: "CircularPDFBold"; src: url("${bold}") format("woff"); font-weight: 700; }` : ''}
      ${black ? `@font-face { font-family: "CircularPDFBlack"; src: url("${black}") format("woff"); font-weight: 900; }` : ''}
    `;
  }

  private fontDataUri(path: string) {
    if (!existsSync(path)) {
      return null;
    }

    return `data:font/woff;base64,${readFileSync(path).toString('base64')}`;
  }

  private getClientDocumentLabel(tipoDocumento: string) {
    if (tipoDocumento === 'ruc') {
      return 'RUC';
    }
    if (tipoDocumento === 'dni') {
      return 'DNI';
    }
    return 'DOC';
  }

  private formatDate(date: Date) {
    return new Intl.DateTimeFormat('es-PE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
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

  private escapeHtml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private escapeAttribute(value: string) {
    return this.escapeHtml(value);
  }
}
