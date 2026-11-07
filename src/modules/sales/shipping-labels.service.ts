import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { VentaEnvioEstado } from '@prisma/client';
import {
  scopedCreatorId,
  type CommercialScope,
} from '../../common/commercial-access';
import { PrismaService } from '../../prisma/prisma.service';
import {
  BatchShippingLabelItemDto,
  PrintShippingLabelBatchDto,
  PrintShippingLabelDto,
  type ShippingLabelOrientation,
  type ShippingLabelPaperFormat,
} from './dto/shipping-label.dto';

const LABEL_WIDTH = 100 * 2.834645669;
const LABEL_HEIGHT = 150 * 2.834645669;
const A4_WIDTH = 210 * 2.834645669;
const A4_HEIGHT = 297 * 2.834645669;
const MAX_LABELS_PER_BATCH = 100;

type RenderOptions = {
  paperFormat: ShippingLabelPaperFormat;
  labelsPerPage: 1 | 2 | 4;
  orientation: ShippingLabelOrientation;
};

type LabelFrame = { x: number; y: number; width: number; height: number };

type ShippingLabelSnapshot = {
  shippingId: bigint;
  salePublicId: string;
  saleCode: string;
  businessName: string;
  branchName: string | null;
  courier: 'SHALOM' | 'OLVA';
  shippingCode: string;
  recipientName: string;
  recipientDocument: string | null;
  recipientPhone: string | null;
  agencyName: string;
  agencyAddress: string | null;
  agencyLocation: string;
  products: Array<{ description: string; quantity: number }>;
};

@Injectable()
export class ShippingLabelsService {
  constructor(private readonly prisma: PrismaService) {}

  async individual(
    empresaId: bigint,
    scope: CommercialScope,
    userId: bigint,
    publicId: string,
    dto: PrintShippingLabelDto,
  ) {
    const snapshot = await this.snapshot(empresaId, scope, publicId);
    const options = this.options(dto);
    const labels = [{ snapshot, packageCount: dto.packageCount }];
    const buffer = await this.render(labels, options);
    await this.audit(userId, labels, options);
    return {
      buffer,
      filename: `etiquetas-${safeFileName(snapshot.saleCode)}.pdf`,
    };
  }

  async batch(
    empresaId: bigint,
    scope: CommercialScope,
    userId: bigint,
    dto: PrintShippingLabelBatchDto,
  ) {
    const items = this.uniqueItems(dto.sales);
    const totalLabels = items.reduce((sum, item) => sum + item.packageCount, 0);
    if (totalLabels > MAX_LABELS_PER_BATCH) {
      throw new BadRequestException(
        `La impresion por lote admite hasta ${MAX_LABELS_PER_BATCH} etiquetas`,
      );
    }
    const snapshots = await Promise.all(
      items.map(async (item) => ({
        snapshot: await this.snapshot(empresaId, scope, item.publicId),
        packageCount: item.packageCount,
      })),
    );
    const options = this.options(dto);
    const buffer = await this.render(snapshots, options);
    await this.audit(userId, snapshots, options);
    return { buffer, filename: 'etiquetas-envios.pdf' };
  }

  private uniqueItems(items: BatchShippingLabelItemDto[]) {
    const unique = new Map<string, BatchShippingLabelItemDto>();
    for (const item of items) unique.set(item.publicId, item);
    return Array.from(unique.values());
  }

  private async snapshot(
    empresaId: bigint,
    scope: CommercialScope,
    publicId: string,
  ): Promise<ShippingLabelSnapshot> {
    const sale = await this.prisma.venta.findFirst({
      where: {
        publicId,
        empresaId,
        ...(scope.branchId ? { sucursalId: scope.branchId } : {}),
        ...(scopedCreatorId(scope)
          ? { creadoPorId: scopedCreatorId(scope)! }
          : {}),
        envio: { isNot: null },
      },
      select: {
        publicId: true,
        correlativo: true,
        empresa: { select: { nombreComercial: true, razonSocial: true } },
        sucursal: { select: { nombre: true } },
        cliente: {
          select: { nombre: true, numeroDocumento: true, telefono: true },
        },
        detalles: {
          select: { descripcion: true, cantidad: true },
          orderBy: { id: 'asc' },
        },
        envio: true,
      },
    });
    if (!sale?.envio) throw new NotFoundException('Envio no encontrado');
    if (
      sale.envio.estado !== VentaEnvioEstado.recibido ||
      !sale.envio.agencia ||
      !sale.envio.agenciaNombre
    ) {
      throw new BadRequestException(
        'Complete los datos del courier y la agencia antes de imprimir',
      );
    }

    const recipientName =
      sale.envio.nombreCompleto?.trim() ||
      sale.cliente?.nombre?.trim() ||
      'CLIENTE';
    return {
      shippingId: sale.envio.id,
      salePublicId: sale.publicId,
      saleCode: sale.correlativo,
      businessName:
        sale.empresa.nombreComercial || sale.empresa.razonSocial || 'NUVEX',
      branchName: sale.sucursal?.nombre ?? null,
      courier: sale.envio.agencia,
      shippingCode: sale.envio.codigoPublico,
      recipientName,
      recipientDocument:
        sale.envio.dni || sale.cliente?.numeroDocumento || null,
      recipientPhone: sale.envio.celular || sale.cliente?.telefono || null,
      agencyName: sale.envio.agenciaNombre,
      agencyAddress: sale.envio.agenciaDireccion,
      agencyLocation: [
        sale.envio.agenciaDistrito,
        sale.envio.agenciaProvincia,
        sale.envio.agenciaDepartamento,
      ]
        .filter(Boolean)
        .join(' / '),
      products: sale.detalles.map((detail) => ({
        description: detail.descripcion || 'Producto',
        quantity: detail.cantidad,
      })),
    };
  }

  private audit(
    userId: bigint,
    labels: Array<{
      snapshot: ShippingLabelSnapshot;
      packageCount: number;
    }>,
    options: RenderOptions,
  ) {
    return this.prisma.ventaEnvioEtiquetaImpresion.createMany({
      data: labels.map(({ snapshot, packageCount }) => ({
        ventaEnvioId: snapshot.shippingId,
        cantidadBultos: packageCount,
        snapshot: {
          ...snapshot,
          shippingId: snapshot.shippingId.toString(),
          print: options,
        },
        impresoPorId: userId,
      })),
    });
  }

  private options(
    dto: Pick<
      PrintShippingLabelDto | PrintShippingLabelBatchDto,
      'paperFormat' | 'labelsPerPage' | 'orientation'
    >,
  ): RenderOptions {
    return {
      paperFormat: dto.paperFormat,
      labelsPerPage: dto.paperFormat === 'THERMAL' ? 1 : dto.labelsPerPage,
      orientation: dto.orientation,
    };
  }

  private render(
    labels: Array<{
      snapshot: ShippingLabelSnapshot;
      packageCount: number;
    }>,
    options: RenderOptions,
  ) {
    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({
        autoFirstPage: false,
        size:
          options.paperFormat === 'THERMAL'
            ? [LABEL_WIDTH, LABEL_HEIGHT]
            : [A4_WIDTH, A4_HEIGHT],
        margin: 0,
        compress: true,
      });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pages: Array<{
        snapshot: ShippingLabelSnapshot;
        packageNumber: number;
        packageCount: number;
      }> = [];
      for (const { snapshot, packageCount } of labels) {
        for (
          let packageNumber = 1;
          packageNumber <= packageCount;
          packageNumber += 1
        ) {
          pages.push({ snapshot, packageNumber, packageCount });
        }
      }

      if (options.paperFormat === 'THERMAL') {
        for (const page of pages) {
          doc.addPage({ size: [LABEL_WIDTH, LABEL_HEIGHT], margin: 0 });
          this.drawLabel(
            doc,
            page.snapshot,
            page.packageNumber,
            page.packageCount,
          );
        }
      } else {
        const frames = this.a4Frames(options);
        for (let offset = 0; offset < pages.length; offset += frames.length) {
          doc.addPage({
            size: [A4_WIDTH, A4_HEIGHT],
            layout: options.orientation.toLowerCase() as
              | 'portrait'
              | 'landscape',
            margin: 0,
          });
          const pageItems = pages.slice(offset, offset + frames.length);
          for (let index = 0; index < pageItems.length; index += 1) {
            const page = pageItems[index];
            this.drawLabelInFrame(
              doc,
              page.snapshot,
              page.packageNumber,
              page.packageCount,
              frames[index],
            );
          }
        }
      }
      doc.end();
    });
  }

  private a4Frames(options: RenderOptions): LabelFrame[] {
    const isLandscape = options.orientation === 'LANDSCAPE';
    const pageWidth = isLandscape ? A4_HEIGHT : A4_WIDTH;
    const pageHeight = isLandscape ? A4_WIDTH : A4_HEIGHT;
    const margin = 18;
    const gap = 10;
    const columns =
      options.labelsPerPage === 1
        ? 1
        : options.labelsPerPage === 2
          ? isLandscape
            ? 2
            : 1
          : 2;
    const rows =
      options.labelsPerPage === 1 ? 1 : options.labelsPerPage / columns;
    const width = (pageWidth - margin * 2 - gap * (columns - 1)) / columns;
    const height = (pageHeight - margin * 2 - gap * (rows - 1)) / rows;

    return Array.from({ length: options.labelsPerPage }, (_, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      return {
        x: margin + column * (width + gap),
        y: margin + row * (height + gap),
        width,
        height,
      };
    });
  }

  private drawLabelInFrame(
    doc: PDFKit.PDFDocument,
    label: ShippingLabelSnapshot,
    packageNumber: number,
    packageCount: number,
    frame: LabelFrame,
  ) {
    const scale = Math.min(
      frame.width / LABEL_WIDTH,
      frame.height / LABEL_HEIGHT,
    );
    const width = LABEL_WIDTH * scale;
    const height = LABEL_HEIGHT * scale;
    doc.save();
    doc.translate(
      frame.x + (frame.width - width) / 2,
      frame.y + (frame.height - height) / 2,
    );
    doc.scale(scale);
    this.drawLabel(doc, label, packageNumber, packageCount);
    doc.restore();
  }

  private drawLabel(
    doc: PDFKit.PDFDocument,
    label: ShippingLabelSnapshot,
    packageNumber: number,
    packageCount: number,
  ) {
    const margin = 16;
    const width = LABEL_WIDTH - margin * 2;
    let y = 14;
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor('#111827')
      .text(label.businessName, margin, y, { width: width * 0.62 });
    doc.fontSize(15).text(label.courier, margin + width * 0.62, y - 2, {
      width: width * 0.38,
      align: 'right',
    });
    y += 27;
    this.line(doc, margin, y, width, 2);
    y += 9;

    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor('#4b5563')
      .text('DESTINATARIO', margin, y);
    y += 10;
    doc
      .font('Helvetica-Bold')
      .fontSize(15)
      .fillColor('#111827')
      .text(label.recipientName.toUpperCase(), margin, y, {
        width,
        height: 38,
        ellipsis: true,
      });
    y += 40;
    doc.font('Helvetica').fontSize(9);
    doc.text(
      [
        label.recipientDocument ? `DOC: ${label.recipientDocument}` : null,
        label.recipientPhone ? `CEL: ${label.recipientPhone}` : null,
      ]
        .filter(Boolean)
        .join('   '),
      margin,
      y,
      { width },
    );
    y += 19;
    this.line(doc, margin, y, width, 1);
    y += 9;

    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor('#4b5563')
      .text('AGENCIA DESTINO', margin, y);
    y += 10;
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor('#111827')
      .text(label.agencyName, margin, y, { width, height: 29, ellipsis: true });
    y += 31;
    doc
      .font('Helvetica')
      .fontSize(8)
      .text(label.agencyLocation || '-', margin, y, { width });
    y += 14;
    doc.text(label.agencyAddress || '-', margin, y, {
      width,
      height: 34,
      ellipsis: true,
    });
    y += 39;
    this.line(doc, margin, y, width, 1);
    y += 9;

    doc
      .font('Helvetica-Bold')
      .fontSize(12)
      .text(`BULTO ${packageNumber} DE ${packageCount}`, margin, y, {
        width,
        align: 'center',
      });
    y += 23;

    const footerY = LABEL_HEIGHT - 40;
    this.line(doc, margin, footerY - 8, width, 1);
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor('#4b5563')
      .text(
        [label.branchName, 'Etiqueta generada por Nuvex']
          .filter(Boolean)
          .join(' · '),
        margin,
        footerY,
        { width, align: 'center' },
      );
    doc
      .rect(3, 3, LABEL_WIDTH - 6, LABEL_HEIGHT - 6)
      .lineWidth(1)
      .strokeColor('#111827')
      .stroke();
  }

  private line(
    doc: PDFKit.PDFDocument,
    x: number,
    y: number,
    width: number,
    lineWidth: number,
  ) {
    doc
      .moveTo(x, y)
      .lineTo(x + width, y)
      .lineWidth(lineWidth)
      .strokeColor('#111827')
      .stroke();
  }
}

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9-_]/g, '-');
}
