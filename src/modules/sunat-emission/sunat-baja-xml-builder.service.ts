import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, SunatBajaTipo, VentaTipoComprobante } from '@prisma/client';
import { create } from 'xmlbuilder2';
import {
  formatSunatBajaNumber,
  formatSunatNumber,
  sunatDocumentCode,
} from './sunat-comprobante.helper';

export const sunatBajaInclude = {
  empresa: true,
  items: {
    include: {
      venta: true,
    },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.SunatBajaLoteInclude;

export type SunatBajaLoteWithItems = Prisma.SunatBajaLoteGetPayload<{
  include: typeof sunatBajaInclude;
}>;

@Injectable()
export class SunatBajaXmlBuilderService {
  build(lote: SunatBajaLoteWithItems) {
    if (lote.tipoEnvio === SunatBajaTipo.RA) {
      return this.buildVoidedDocuments(lote);
    }

    return this.buildSummaryDocuments(lote);
  }

  private buildVoidedDocuments(lote: SunatBajaLoteWithItems) {
    this.validate(lote, SunatBajaTipo.RA);
    const root = this.root('VoidedDocuments', {
      xmlns:
        'urn:sunat:names:specification:ubl:peru:schema:xsd:VoidedDocuments-1',
    });

    this.appendHeader(root, lote, '2.0', '1.0');
    this.appendSignature(root, lote);
    this.appendSupplier(root, lote);

    lote.items.forEach((item, index) => {
      const line = root.ele('sac:VoidedDocumentsLine');
      line.ele('cbc:LineID').txt(String(index + 1));
      line
        .ele('cbc:DocumentTypeCode')
        .txt(sunatDocumentCode(item.tipoComprobante));
      line.ele('sac:DocumentSerialID').txt(item.serie);
      line.ele('sac:DocumentNumberID').txt(String(item.numero));
      line.ele('sac:VoidReasonDescription').txt(item.motivo);
    });

    return root.end({ prettyPrint: false });
  }

  private buildSummaryDocuments(lote: SunatBajaLoteWithItems) {
    this.validate(lote, SunatBajaTipo.RC);
    const root = this.root('SummaryDocuments', {
      xmlns:
        'urn:sunat:names:specification:ubl:peru:schema:xsd:SummaryDocuments-1',
    });

    this.appendHeader(root, lote, '2.0', '1.1');
    this.appendSignature(root, lote);
    this.appendSupplier(root, lote);

    lote.items.forEach((item, index) => {
      const venta = item.venta;
      const line = root.ele('sac:SummaryDocumentsLine');
      line.ele('cbc:LineID').txt(String(index + 1));
      line
        .ele('cbc:DocumentTypeCode')
        .txt(sunatDocumentCode(item.tipoComprobante));
      line.ele('cbc:ID').txt(formatSunatNumber(item.serie, item.numero));
      line.ele('cac:Status').ele('cbc:ConditionCode').txt('3');
      this.amount(
        line,
        'sac:TotalAmount',
        venta.total.toFixed(2),
        venta.moneda,
      );

      const payment = line.ele('sac:BillingPayment');
      this.amount(
        payment,
        'cbc:PaidAmount',
        venta.opGravadas.toFixed(2),
        venta.moneda,
      );
      payment.ele('cbc:InstructionID').txt('01');

      const taxTotal = line.ele('cac:TaxTotal');
      this.amount(
        taxTotal,
        'cbc:TaxAmount',
        venta.igvMonto.toFixed(2),
        venta.moneda,
      );
      const taxSubtotal = taxTotal.ele('cac:TaxSubtotal');
      this.amount(
        taxSubtotal,
        'cbc:TaxAmount',
        venta.igvMonto.toFixed(2),
        venta.moneda,
      );
      const taxCategory = taxSubtotal.ele('cac:TaxCategory');
      taxCategory.ele('cbc:Percent').txt(venta.igvPorcentaje.toFixed(2));
      const taxScheme = taxCategory.ele('cac:TaxScheme');
      taxScheme.ele('cbc:ID').txt('1000');
      taxScheme.ele('cbc:Name').txt('IGV');
      taxScheme.ele('cbc:TaxTypeCode').txt('VAT');
    });

    return root.end({ prettyPrint: false });
  }

  private root(name: string, attrs: Record<string, string>) {
    return create({ version: '1.0', encoding: 'UTF-8' }).ele(name, {
      ...attrs,
      'xmlns:cac':
        'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
      'xmlns:cbc':
        'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
      'xmlns:ext':
        'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
      'xmlns:sac':
        'urn:sunat:names:specification:ubl:peru:schema:xsd:SunatAggregateComponents-1',
      'xmlns:ds': 'http://www.w3.org/2000/09/xmldsig#',
    });
  }

  private appendHeader(
    root: ReturnType<typeof create>,
    lote: SunatBajaLoteWithItems,
    ublVersion: string,
    customization: string,
  ) {
    root
      .ele('ext:UBLExtensions')
      .ele('ext:UBLExtension')
      .ele('ext:ExtensionContent');
    root.ele('cbc:UBLVersionID').txt(ublVersion);
    root.ele('cbc:CustomizationID').txt(customization);
    root.ele('cbc:ID').txt(this.loteNumber(lote));
    root.ele('cbc:ReferenceDate').txt(this.date(lote.fechaDocumento));
    root.ele('cbc:IssueDate').txt(this.date(lote.fechaGeneracion));
  }

  private appendSignature(
    root: ReturnType<typeof create>,
    lote: SunatBajaLoteWithItems,
  ) {
    const signatureId = `SIGN-${lote.empresa.ruc?.trim() ?? ''}`;
    const signature = root.ele('cac:Signature');
    signature.ele('cbc:ID').txt(signatureId);
    const party = signature.ele('cac:SignatoryParty');
    party
      .ele('cac:PartyIdentification')
      .ele('cbc:ID')
      .txt(lote.empresa.ruc ?? '');
    party
      .ele('cac:PartyName')
      .ele('cbc:Name')
      .txt(lote.empresa.nombreComercial || lote.empresa.razonSocial || '');
    signature
      .ele('cac:DigitalSignatureAttachment')
      .ele('cac:ExternalReference')
      .ele('cbc:URI')
      .txt(`#${signatureId}`);
  }

  private appendSupplier(
    root: ReturnType<typeof create>,
    lote: SunatBajaLoteWithItems,
  ) {
    const supplier = root.ele('cac:AccountingSupplierParty');
    supplier.ele('cbc:CustomerAssignedAccountID').txt(lote.empresa.ruc ?? '');
    supplier.ele('cbc:AdditionalAccountID').txt('6');
    supplier
      .ele('cac:Party')
      .ele('cac:PartyLegalEntity')
      .ele('cbc:RegistrationName')
      .txt(lote.empresa.razonSocial || lote.empresa.nombreComercial);
  }

  private amount(
    parent: ReturnType<typeof create>,
    qName: string,
    value: string,
    currency: string,
  ) {
    parent.ele(qName, { currencyID: currency || 'PEN' }).txt(value);
  }

  private validate(lote: SunatBajaLoteWithItems, tipo: SunatBajaTipo) {
    if (!lote.empresa.ruc || !lote.empresa.razonSocial) {
      throw new BadRequestException(
        'La empresa debe tener RUC y razon social para generar baja SUNAT',
      );
    }

    if (!lote.items.length) {
      throw new BadRequestException('El lote de baja no tiene items');
    }

    for (const item of lote.items) {
      if (
        tipo === SunatBajaTipo.RA &&
        item.tipoComprobante !== VentaTipoComprobante.factura
      ) {
        throw new BadRequestException('El lote RA solo permite facturas');
      }

      if (
        tipo === SunatBajaTipo.RC &&
        item.tipoComprobante !== VentaTipoComprobante.boleta
      ) {
        throw new BadRequestException('El lote RC solo permite boletas');
      }
    }
  }

  private loteNumber(lote: SunatBajaLoteWithItems) {
    return formatSunatBajaNumber({
      tipo: lote.tipoEnvio,
      fechaGeneracion: lote.fechaGeneracion,
      correlativo: lote.correlativo,
    });
  }

  private date(value: Date) {
    return value.toISOString().slice(0, 10);
  }
}
