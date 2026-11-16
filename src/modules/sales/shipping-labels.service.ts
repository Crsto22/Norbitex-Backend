import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import PDFDocument from 'pdfkit';
import { Prisma, VentaEnvioEstado } from '@prisma/client';
import {
  scopedCreatorId,
  type CommercialScope,
} from '../../common/commercial-access';
import { PrismaService } from '../../prisma/prisma.service';
import {
  BatchShippingLabelItemDto,
  PrintShippingLabelBatchDto,
  PrintShippingLabelDto,
  type ShippingLabelColumns,
} from './dto/shipping-label.dto';

const LABEL_WIDTH = 115 * 2.834645669;
const LABEL_HEIGHT = 60 * 2.834645669;
const A4_WIDTH = 210 * 2.834645669;
const A4_HEIGHT = 297 * 2.834645669;
const MAX_LABELS_PER_BATCH = 250;

type RenderOptions = {
  columns: ShippingLabelColumns;
};

type LabelFrame = { x: number; y: number; width: number; height: number };

type ShippingLabelSnapshot = {
  shippingId: bigint;
  salePublicId: string;
  saleCode: string;
  businessName: string;
  branchName: string | null;
  service: string;
  serviceLabel: string;
  destinationTitle: string;
  shippingCode: string;
  recipientName: string;
  recipientDocument: string | null;
  recipientPhone: string | null;
  agencyName: string;
  agencyAddress: string | null;
  agencyLocation: string | null;
  products: Array<{ description: string; quantity: number }>;
};

const PICKUP_METHOD = 'RECOJO';
const LOCAL_DELIVERY_METHODS = ['MOTORIZADO', 'DOMICILIO'] as const;

const shippingLabelSaleSelect = {
  publicId: true,
  correlativo: true,
  empresa: { select: { nombreComercial: true, razonSocial: true } },
  sucursal: { select: { nombre: true } },
  cliente: {
    select: { nombre: true, numeroDocumento: true, telefono: true },
  },
  detalles: {
    select: { descripcion: true, cantidad: true },
    orderBy: { id: 'asc' as const },
  },
  envio: true,
} satisfies Prisma.VentaSelect;

type ShippingLabelSale = Prisma.VentaGetPayload<{
  select: typeof shippingLabelSaleSelect;
}>;

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
    const snapshots = await this.snapshots(empresaId, scope, items);
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

  private async snapshots(
    empresaId: bigint,
    scope: CommercialScope,
    items: BatchShippingLabelItemDto[],
  ) {
    const sales = await this.prisma.venta.findMany({
      where: {
        publicId: { in: items.map((item) => item.publicId) },
        empresaId,
        ...(scope.branchId ? { sucursalId: scope.branchId } : {}),
        ...(scopedCreatorId(scope)
          ? { creadoPorId: scopedCreatorId(scope)! }
          : {}),
        envio: { isNot: null },
      },
      select: shippingLabelSaleSelect,
    });
    const byPublicId = new Map(sales.map((sale) => [sale.publicId, sale]));

    return items.map((item) => {
      const sale = byPublicId.get(item.publicId);
      if (!sale?.envio) throw new NotFoundException('Envio no encontrado');
      return {
        snapshot: this.buildSnapshot(sale),
        packageCount: item.packageCount,
      };
    });
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
      select: shippingLabelSaleSelect,
    });
    if (!sale?.envio) throw new NotFoundException('Envio no encontrado');
    return this.buildSnapshot(sale);
  }

  private buildSnapshot(sale: ShippingLabelSale): ShippingLabelSnapshot {
    const envio = sale.envio!;
    const metodoEnvio = (envio.metodoEnvio ?? '').trim().toUpperCase();
    const isPickup = metodoEnvio === PICKUP_METHOD;
    const isLocalDelivery = (
      LOCAL_DELIVERY_METHODS as readonly string[]
    ).includes(metodoEnvio);
    if (envio.estado !== VentaEnvioEstado.recibido) {
      throw new BadRequestException(
        'El envio debe estar recibido antes de imprimir la etiqueta',
      );
    }
    if (!isLocalDelivery && !isPickup && !envio.agencia) {
      throw new BadRequestException(
        'Seleccione el courier del envio antes de imprimir la etiqueta',
      );
    }

    const recipientName =
      envio.nombreCompleto?.trim() ||
      sale.cliente?.nombre?.trim() ||
      'CLIENTE';
    const location = [
      envio.agenciaDistrito,
      envio.agenciaProvincia,
      envio.agenciaDepartamento,
    ]
      .filter(Boolean)
      .join(' / ');
    const referencia = envio.referenciaEntrega?.trim();
    const pickupAddress =
      envio.agenciaDireccion?.trim() ||
      envio.direccionEntrega?.trim() ||
      null;
    const pickupStoreName =
      sale.sucursal?.nombre?.trim() ||
      envio.agenciaNombre?.trim() ||
      'TIENDA';
    return {
      shippingId: envio.id,
      salePublicId: sale.publicId,
      saleCode: sale.correlativo,
      businessName:
        sale.empresa.nombreComercial || sale.empresa.razonSocial || 'NUVEX',
      branchName: sale.sucursal?.nombre ?? null,
      service: isPickup
        ? PICKUP_METHOD
        : isLocalDelivery
          ? metodoEnvio
          : (envio.agencia as string),
      serviceLabel: isPickup
        ? 'RECOJO EN TIENDA'
        : isLocalDelivery
          ? metodoEnvio
          : (envio.agencia as string),
      destinationTitle: isPickup
        ? 'RECOJO EN TIENDA'
        : isLocalDelivery
          ? 'DIRECCION DE ENTREGA'
          : 'AGENCIA DESTINO',
      shippingCode: envio.codigoPublico,
      recipientName,
      recipientDocument:
        envio.dni || sale.cliente?.numeroDocumento || null,
      recipientPhone: envio.celular || sale.cliente?.telefono || null,
      agencyName: isPickup
        ? pickupStoreName
        : isLocalDelivery
          ? envio.direccionEntrega?.trim() || 'SIN DIRECCION'
          : envio.agenciaNombre?.trim() || (envio.agencia as string),
      agencyAddress: isPickup
        ? pickupAddress
        : isLocalDelivery
          ? referencia
            ? `Ref: ${referencia}`
            : null
          : envio.agenciaDireccion,
      agencyLocation: isPickup ? null : location,
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
    dto: Pick<PrintShippingLabelDto | PrintShippingLabelBatchDto, 'columns'>,
  ): RenderOptions {
    return {
      columns: dto.columns,
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
        size: [A4_WIDTH, A4_HEIGHT],
        margin: 0,
        compress: true,
      });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pages: Array<{ snapshot: ShippingLabelSnapshot }> = [];
      for (const { snapshot, packageCount } of labels) {
        for (let index = 0; index < packageCount; index += 1) {
          pages.push({ snapshot });
        }
      }

      const frames = this.a4Frames(options);
      for (let offset = 0; offset < pages.length; offset += frames.length) {
        doc.addPage({ size: [A4_WIDTH, A4_HEIGHT], margin: 0 });
        const pageItems = pages.slice(offset, offset + frames.length);
        for (let index = 0; index < pageItems.length; index += 1) {
          const page = pageItems[index];
          this.drawLabelInFrame(doc, page.snapshot, frames[index]);
        }
      }
      doc.end();
    });
  }

  private a4Frames(options: RenderOptions): LabelFrame[] {
    const margin = 18;
    const gap = 10;
    const columns = options.columns;
    const rows = columns === 1 ? 3 : 5;
    const width = (A4_WIDTH - margin * 2 - gap * (columns - 1)) / columns;
    const height = (A4_HEIGHT - margin * 2 - gap * (rows - 1)) / rows;

    return Array.from({ length: columns * rows }, (_, index) => {
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
    this.drawLabel(doc, label);
    doc.restore();
  }

  private drawLabel(doc: PDFKit.PDFDocument, label: ShippingLabelSnapshot) {
    const margin = 11;
    const width = LABEL_WIDTH - margin * 2;
    let y = 10;
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor('#111827')
      .text(label.businessName, margin, y, { width: width * 0.62 });
    doc.fontSize(11).text(label.serviceLabel, margin + width * 0.62, y - 1, {
      width: width * 0.38,
      align: 'right',
    });
    y += 17;
    this.line(doc, margin, y, width, 1.2);
    y += 5;

    doc
      .font('Helvetica')
      .fontSize(5.5)
      .fillColor('#4b5563')
      .text('DESTINATARIO', margin, y);
    y += 7;
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor('#111827')
      .text(label.recipientName.toUpperCase(), margin, y, {
        width,
        height: 15,
        ellipsis: true,
      });
    y += 17;
    doc.font('Helvetica').fontSize(6.5);
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
    y += 12;
    this.line(doc, margin, y, width, 1);
    y += 5;

    doc
      .font('Helvetica')
      .fontSize(7)
      .fillColor('#4b5563')
      .text(label.destinationTitle, margin, y);
    y += 10;
    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor('#111827')
      .text(label.agencyName, margin, y, { width, height: 29, ellipsis: true });
    y += 31;
    if (label.agencyLocation) {
      doc
        .font('Helvetica')
        .fontSize(8)
        .text(label.agencyLocation, margin, y, { width });
      y += 14;
    }
    if (label.agencyAddress) {
      doc.font('Helvetica').fontSize(8).text(label.agencyAddress, margin, y, {
        width,
        height: 34,
        ellipsis: true,
      });
    }
    y += 39;

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
