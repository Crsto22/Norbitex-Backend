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
} from './dto/shipping-label.dto';

const LABEL_WIDTH = 100 * 2.834645669;
const LABEL_HEIGHT = 150 * 2.834645669;
const MAX_LABELS_PER_BATCH = 100;

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
    const buffer = await this.render([
      { snapshot, packageCount: dto.packageCount },
    ]);
    await this.audit(userId, [{ snapshot, packageCount: dto.packageCount }]);
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
    const buffer = await this.render(snapshots);
    await this.audit(userId, snapshots);
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
  ) {
    return this.prisma.ventaEnvioEtiquetaImpresion.createMany({
      data: labels.map(({ snapshot, packageCount }) => ({
        ventaEnvioId: snapshot.shippingId,
        cantidadBultos: packageCount,
        snapshot: {
          ...snapshot,
          shippingId: snapshot.shippingId.toString(),
        },
        impresoPorId: userId,
      })),
    });
  }

  private render(
    labels: Array<{
      snapshot: ShippingLabelSnapshot;
      packageCount: number;
    }>,
  ) {
    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({
        autoFirstPage: false,
        size: [LABEL_WIDTH, LABEL_HEIGHT],
        margin: 0,
        compress: true,
      });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      for (const { snapshot, packageCount } of labels) {
        for (
          let packageNumber = 1;
          packageNumber <= packageCount;
          packageNumber += 1
        ) {
          doc.addPage({ size: [LABEL_WIDTH, LABEL_HEIGHT], margin: 0 });
          this.drawLabel(doc, snapshot, packageNumber, packageCount);
        }
      }
      doc.end();
    });
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
      .fontSize(10)
      .text(`VENTA: ${label.saleCode}`, margin, y, {
        width: width * 0.58,
      });
    doc
      .fontSize(12)
      .text(
        `BULTO ${packageNumber} DE ${packageCount}`,
        margin + width * 0.58,
        y - 1,
        {
          width: width * 0.42,
          align: 'right',
        },
      );
    y += 23;
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor('#4b5563')
      .text('CONTENIDO', margin, y);
    y += 9;
    const productLines = label.products
      .slice(0, 4)
      .map((product) => `${product.quantity} x ${product.description}`);
    if (label.products.length > 4) {
      productLines.push(`+ ${label.products.length - 4} productos adicionales`);
    }
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#111827')
      .text(productLines.join('\n'), margin, y, {
        width,
        height: 52,
        ellipsis: true,
      });

    const codeY = LABEL_HEIGHT - 63;
    this.line(doc, margin, codeY - 8, width, 1);
    doc
      .font('Helvetica-Bold')
      .fontSize(18)
      .text(label.shippingCode, margin, codeY, { width, align: 'center' });
    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor('#4b5563')
      .text(
        [label.branchName, 'Etiqueta generada por Nuvex']
          .filter(Boolean)
          .join(' · '),
        margin,
        codeY + 25,
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
