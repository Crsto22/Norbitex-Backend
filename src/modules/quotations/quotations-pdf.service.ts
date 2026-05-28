import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import puppeteer from 'puppeteer';
import { PrismaService } from '../../prisma/prisma.service';
import { LocalPdfLogoStorageService } from '../storage/local-pdf-logo-storage.service';

const quotationPdfInclude = {
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
} satisfies Prisma.CotizacionInclude;

type QuotationForPdf = Prisma.CotizacionGetPayload<{
  include: typeof quotationPdfInclude;
}>;

@Injectable()
export class QuotationsPdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly localPdfLogoStorageService: LocalPdfLogoStorageService,
  ) {}

  async generateQuotationPdf(empresaId: bigint, publicId: string) {
    const quotation = await this.prisma.cotizacion.findFirst({
      where: { empresaId, publicId },
      include: quotationPdfInclude,
    });

    if (!quotation) {
      throw new NotFoundException('Cotizacion no encontrada');
    }

    const html = await this.buildHtml(quotation);
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

  private async buildHtml(quotation: QuotationForPdf) {
    const empresaNombre =
      quotation.empresa.razonSocial || quotation.empresa.nombreComercial || '';
    const empresaDireccion =
      quotation.empresa.direccion ||
      quotation.sucursal?.direccion ||
      [quotation.sucursal?.distrito, quotation.sucursal?.ubigeo]
        .filter(Boolean)
        .join(' - ');
    const clienteNombre =
      quotation.cliente?.razonSocial ||
      quotation.cliente?.nombre ||
      'CLIENTE GENERAL';
    const clienteDocumento = quotation.cliente?.numeroDocumento
      ? `${this.getClientDocumentLabel(quotation.cliente.tipoDocumento)}: ${quotation.cliente.numeroDocumento}`
      : '';
    const totalItems = quotation.detalles.reduce(
      (sum, item) => sum + item.cantidad,
      0,
    );
    const logoDataUri = await this.resolveCompanyLogoDataUri(quotation);
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
    .amount-words { min-height: 80px; }
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
        ${quotation.empresa.ruc ? `<div>R.U.C. Nro ${this.escapeHtml(quotation.empresa.ruc)}</div>` : ''}
        <div>COTIZACION</div>
        <div>${this.escapeHtml(quotation.correlativo)}</div>
      </div>
    </section>

    <section class="customer-box">
      <div class="row"><div class="label">Fecha emision</div><div>:</div><div>${this.formatDate(quotation.createdAt)}</div></div>
      ${quotation.validaHasta ? `<div class="row"><div class="label">Valida hasta</div><div>:</div><div>${this.formatDate(quotation.validaHasta)}</div></div>` : ''}
      <div class="row"><div class="label">Senor(es)</div><div>:</div><div>${this.escapeHtml(clienteNombre)}</div></div>
      ${clienteDocumento ? `<div class="row"><div class="label">Documento</div><div>:</div><div>${this.escapeHtml(clienteDocumento)}</div></div>` : ''}
      ${quotation.cliente?.direccion ? `<div class="row"><div class="label">Direccion</div><div>:</div><div>${this.escapeHtml(quotation.cliente.direccion)}</div></div>` : ''}
    </section>

    <table>
      <thead>
        <tr>
          <th class="center" style="width: 58px;">Cant.</th>
          <th style="width: 76px;">Unidad</th>
          <th style="width: 88px;">Codigo</th>
          <th>Descripcion</th>
          <th class="right" style="width: 82px;">P.U.</th>
          <th class="right" style="width: 82px;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${quotation.detalles.map((item) => this.buildDetailRow(item)).join('')}
        <tr class="totals-row">
          <td colspan="4"></td>
          <td class="totals-label">SUBTOTAL</td>
          <td class="right">S/ ${this.money(quotation.subtotal)}</td>
        </tr>
        ${
          quotation.descuentoMonto.gt(0)
            ? `<tr class="totals-row"><td colspan="4"></td><td class="totals-label">DESCUENTO</td><td class="right">S/ ${this.money(quotation.descuentoMonto)}</td></tr>`
            : ''
        }
        <tr class="totals-row">
          <td colspan="4"></td>
          <td class="totals-label">IMPORTE TOTAL</td>
          <td class="right total-amount">S/ ${this.money(quotation.total)}</td>
        </tr>
      </tbody>
    </table>

    <section class="box amount-words">
      <div><span class="label">IMPORTE EN LETRAS:</span> ${this.escapeHtml(this.amountToWords(quotation.total))}</div>
      <div><span class="label">RESUMEN:</span> ${totalItems} unidad(es) cotizada(s)</div>
    </section>

    ${
      quotation.observaciones
        ? `<section class="box"><div class="label">OBSERVACIONES:</div><div>${this.escapeHtml(quotation.observaciones)}</div></section>`
        : ''
    }

    <div class="footer-note">
      Representacion impresa de la cotizacion.
    </div>
  </main>
</body>
</html>`;
  }

  private buildDetailRow(item: QuotationForPdf['detalles'][number]) {
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

  private async resolveCompanyLogoDataUri(quotation: QuotationForPdf) {
    const localLogo = await this.localPdfLogoStorageService.resolveToDataUri(
      quotation.empresa.logoPdfUrl,
    );

    if (localLogo) {
      return localLogo;
    }

    if (quotation.empresa.logoUrl) {
      const stored = await this.localPdfLogoStorageService.saveCompanyLogoFromUrl(
        {
          empresaId: quotation.empresa.id,
          imageUrl: quotation.empresa.logoUrl,
          previousUrl: quotation.empresa.logoPdfUrl,
        },
      );

      if (stored) {
        await this.prisma.empresa.update({
          where: { id: quotation.empresa.id },
          data: { logoPdfUrl: stored.url },
        });

        return this.localPdfLogoStorageService.resolveToDataUri(stored.url);
      }
    }

    return this.resolveRemoteImageDataUri(quotation.empresa.logoUrl);
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
