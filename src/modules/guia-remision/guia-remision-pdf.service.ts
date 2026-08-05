import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { launchPdfBrowser } from '../../common/puppeteer-browser';
import { PrismaService } from '../../prisma/prisma.service';

const guiaPdfInclude = {
  empresa: {
    select: {
      nombreComercial: true,
      razonSocial: true,
      ruc: true,
      direccion: true,
    },
  },
  sucursal: { select: { nombre: true, direccion: true, ubigeo: true } },
  detalles: { orderBy: { id: 'asc' } },
  documentosRelacionados: { orderBy: { id: 'asc' } },
  participantes: { orderBy: { id: 'asc' } },
  vehiculos: { orderBy: { id: 'asc' } },
} satisfies Prisma.GuiaRemisionInclude;

type GuiaForPdf = Prisma.GuiaRemisionGetPayload<{
  include: typeof guiaPdfInclude;
}>;

@Injectable()
export class GuiaRemisionPdfService {
  constructor(private readonly prisma: PrismaService) {}

  async generatePdf(empresaId: bigint, publicId: string) {
    const guia = await this.prisma.guiaRemision.findFirst({
      where: { empresaId, publicId },
      include: guiaPdfInclude,
    });
    if (!guia) {
      throw new NotFoundException('Guia de remision no encontrada');
    }

    const browser = await launchPdfBrowser();
    try {
      const page = await browser.newPage();
      await page.setContent(this.buildHtml(guia), {
        waitUntil: 'domcontentloaded',
      });
      return await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '12mm', right: '12mm', bottom: '12mm', left: '12mm' },
      });
    } finally {
      await browser.close();
    }
  }

  private buildHtml(guia: GuiaForPdf) {
    const empresa = guia.empresa.razonSocial || guia.empresa.nombreComercial;
    const conductores = guia.participantes.filter(
      (p) => p.tipo === 'conductor',
    );
    const transportistas = guia.participantes.filter(
      (p) => p.tipo === 'transportista',
    );

    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    * { box-sizing: border-box; }
    body { font-family: Arial, sans-serif; color: #111827; font-size: 11px; margin: 0; }
    .header { display: grid; grid-template-columns: 1fr 210px; gap: 16px; margin-bottom: 16px; }
    .box { border: 1px solid #d1d5db; padding: 10px; border-radius: 6px; }
    .doc { text-align: center; font-weight: 700; font-size: 15px; }
    .muted { color: #6b7280; }
    h1 { font-size: 18px; margin: 0 0 6px; }
    h2 { font-size: 12px; margin: 14px 0 6px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; margin-top: 6px; }
    th, td { border: 1px solid #e5e7eb; padding: 6px; text-align: left; vertical-align: top; }
    th { background: #f3f4f6; font-weight: 700; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .status { margin-top: 14px; font-size: 10px; color: #4b5563; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>${this.escape(empresa)}</h1>
      <div>RUC: ${this.escape(guia.empresa.ruc ?? '')}</div>
      <div>${this.escape(guia.empresa.direccion ?? guia.sucursal.direccion)}</div>
      <div class="muted">Sucursal: ${this.escape(guia.sucursal.nombre)}</div>
    </div>
    <div class="box doc">
      GUIA DE REMISION REMITENTE<br />
      ELECTRONICA<br /><br />
      ${this.escape(guia.correlativo)}
    </div>
  </div>

  <div class="grid">
    <div class="box">
      <strong>Destinatario</strong><br />
      ${this.escape(guia.destinatarioRazonSocial)}<br />
      Doc. ${this.escape(guia.destinatarioTipoDoc)}:
      ${this.escape(guia.destinatarioNroDoc)}
    </div>
    <div class="box">
      <strong>Traslado</strong><br />
      Emision: ${this.formatDate(guia.fechaEmision)}<br />
      Inicio: ${this.formatDate(guia.fechaInicioTraslado)}<br />
      Motivo: ${this.escape(guia.motivoTraslado)}
      ${guia.descripcionMotivo ? ` - ${this.escape(guia.descripcionMotivo)}` : ''}<br />
      Modalidad: ${this.escape(guia.modalidadTransporte)}
    </div>
  </div>

  <h2>Puntos De Traslado</h2>
  <div class="grid">
    <div class="box"><strong>Partida</strong><br />${this.escape(guia.ubigeoPartida)}<br />${this.escape(guia.direccionPartida)}</div>
    <div class="box"><strong>Llegada</strong><br />${this.escape(guia.ubigeoLlegada)}<br />${this.escape(guia.direccionLlegada)}</div>
  </div>

  <h2>Detalle</h2>
  <table>
    <thead><tr><th>#</th><th>Codigo</th><th>Descripcion</th><th>Cantidad</th><th>Unidad</th><th>Peso</th></tr></thead>
    <tbody>
      ${guia.detalles
        .map(
          (d, index) => `<tr>
            <td>${index + 1}</td>
            <td>${this.escape(d.codigoProducto ?? '')}</td>
            <td>${this.escape(d.descripcion)}</td>
            <td>${d.cantidad.toString()}</td>
            <td>${this.escape(d.unidadMedida)}</td>
            <td>${d.pesoUnitario?.toString() ?? ''}</td>
          </tr>`,
        )
        .join('')}
    </tbody>
  </table>

  <h2>Transporte</h2>
  <div class="grid">
    <div class="box"><strong>Conductores</strong><br />${conductores
      .map((c) =>
        this.escape(
          `${c.nombres ?? ''} ${c.apellidos ?? ''} - ${c.numeroDocumento} - Lic. ${c.licencia ?? ''}`,
        ),
      )
      .join('<br />')}</div>
    <div class="box"><strong>Transportistas</strong><br />${transportistas
      .map((t) =>
        this.escape(
          `${t.razonSocial ?? ''} - ${t.numeroDocumento} - MTC ${t.registroMtc ?? ''}`,
        ),
      )
      .join('<br />')}</div>
  </div>

  <h2>Vehiculos Y Documentos Relacionados</h2>
  <div class="grid">
    <div class="box">${guia.vehiculos.map((v) => this.escape(v.placa)).join('<br />')}</div>
    <div class="box">${guia.documentosRelacionados
      .map((d) => this.escape(`${d.tipoDocumento} ${d.serie}-${d.numero}`))
      .join('<br />')}</div>
  </div>

  <div class="status">
    SUNAT: ${this.escape(guia.sunatEstado)}
    ${guia.sunatCodigo ? ` - ${this.escape(guia.sunatCodigo)}` : ''}
    ${guia.sunatMensaje ? ` - ${this.escape(guia.sunatMensaje)}` : ''}
  </div>
</body>
</html>`;
  }

  private formatDate(date: Date) {
    return date.toISOString().slice(0, 10);
  }

  private escape(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
