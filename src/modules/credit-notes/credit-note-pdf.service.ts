import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ProductoTipo } from '@prisma/client';
import sharp from 'sharp';
import { PrismaService } from '../../prisma/prisma.service';
import { SalesPdfService } from '../sales/sales-pdf.service';
import { LocalPdfLogoStorageService } from '../storage/local-pdf-logo-storage.service';

const creditNotePdfInclude = {
  empresa: {
    select: {
      nombreComercial: true,
      razonSocial: true,
      ruc: true,
      direccion: true,
      logoPdfUrl: true,
      sunatConfig: { select: { ambiente: true } },
    },
  },
  sucursal: { select: { direccion: true } },
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
          productoColor: { include: { color: { select: { nombre: true } } } },
          talla: { select: { nombre: true } },
        },
      },
    },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.NotaCreditoInclude;

type CreditNoteForPdf = Prisma.NotaCreditoGetPayload<{
  include: typeof creditNotePdfInclude;
}>;

@Injectable()
export class CreditNotePdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salesPdfService: SalesPdfService,
    private readonly localPdfLogoStorageService: LocalPdfLogoStorageService,
  ) {}

  async generatePdf(empresaId: bigint, publicId: string) {
    const note = await this.prisma.notaCredito.findFirst({
      where: { empresaId, publicId },
      include: creditNotePdfInclude,
    });

    if (!note) throw new NotFoundException('Nota de credito no encontrada');

    return this.salesPdfService.generateCommercialDocumentPdf({
      issuer: {
        name: note.empresa.razonSocial || note.empresa.nombreComercial,
        tradeName: note.empresa.nombreComercial,
        ruc: note.empresa.ruc,
        address: note.empresa.direccion || note.sucursal?.direccion || null,
        environment: note.empresa.sunatConfig?.ambiente ?? 'BETA',
        logoBuffer: await this.logoBuffer(note),
      },
      customer: {
        name: note.cliente?.razonSocial || note.cliente?.nombre || 'CLIENTE',
        document: note.cliente?.numeroDocumento ?? null,
        documentType: note.cliente?.tipoDocumento ?? 'sin_documento',
        address: note.cliente?.direccion ?? null,
      },
      type: note.tipoComprobante,
      series: note.serie,
      number: note.numero,
      issuedAt: note.createdAt,
      sunatStatus: note.sunatEstado,
      sunatCode: note.sunatCodigo,
      items: note.detalles.map((item) => ({
        description: this.itemDescription(item),
        quantity: new Prisma.Decimal(item.cantidad),
        unitPrice: item.precioUnitario,
        total: item.total,
      })),
      baseAmount: note.opGravadas,
      exemptAmount: note.opExoneradas,
      unaffectedAmount: note.opInafectas,
      igv: note.igvMonto,
      igvPercent: note.igvPorcentaje,
      total: note.total,
      paymentLabel: 'Documento de ajuste',
      observations: `Comprobante afectado: ${note.correlativoRef}\nMotivo: ${note.codigoMotivo} - ${note.descripcionMotivo}`,
    });
  }

  private itemDescription(item: CreditNoteForPdf['detalles'][number]) {
    const variant = item.productoVariante;
    if (variant.producto.tipo === ProductoTipo.normal) {
      return item.descripcion || variant.producto.nombre;
    }
    return [
      item.descripcion || variant.producto.nombre,
      variant.productoColor.color.nombre,
      `Talla ${variant.talla.nombre}`,
    ]
      .filter(Boolean)
      .join(' - ');
  }

  private async logoBuffer(note: CreditNoteForPdf) {
    const dataUri = await this.localPdfLogoStorageService.resolveToDataUri(
      note.empresa.logoPdfUrl,
    );
    if (!dataUri) return null;
    const encoded = dataUri.slice(dataUri.indexOf(',') + 1);
    return sharp(Buffer.from(encoded, 'base64')).png().toBuffer();
  }
}
