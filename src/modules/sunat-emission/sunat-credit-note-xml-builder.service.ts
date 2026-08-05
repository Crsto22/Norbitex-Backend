import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { create } from 'xmlbuilder2';
import {
  formatSunatNumber,
  sunatCustomerDocumentCode,
} from './sunat-comprobante.helper';

type CreditNoteForXml = Prisma.NotaCreditoGetPayload<{
  include: {
    empresa: true;
    sucursal: true;
    cliente: true;
    detalles: {
      include: {
        productoVariante: { include: { producto: true } };
      };
    };
  };
}>;

type XmlNode = ReturnType<typeof create>;

@Injectable()
export class SunatCreditNoteXmlBuilderService {
  build(note: CreditNoteForXml) {
    this.validate(note);

    const root = create({ version: '1.0', encoding: 'UTF-8' }).ele(
      'CreditNote',
      {
        xmlns: 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2',
        'xmlns:cac':
          'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
        'xmlns:cbc':
          'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2',
        'xmlns:ext':
          'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
        'xmlns:ds': 'http://www.w3.org/2000/09/xmldsig#',
        'xmlns:sac':
          'urn:sunat:names:specification:ubl:peru:schema:xsd:SunatAggregateComponents-1',
        'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
      },
    );

    root
      .ele('ext:UBLExtensions')
      .ele('ext:UBLExtension')
      .ele('ext:ExtensionContent');
    root.ele('cbc:UBLVersionID').txt('2.1');
    root.ele('cbc:CustomizationID').txt('2.0');
    root.ele('cbc:ID').txt(formatSunatNumber(note.serie, note.numero));
    root.ele('cbc:IssueDate').txt(note.createdAt.toISOString().slice(0, 10));
    root.ele('cbc:IssueTime').txt(note.createdAt.toISOString().slice(11, 19));
    root
      .ele('cbc:Note', { languageLocaleID: '1000' })
      .txt(`SON ${note.total.toFixed(2)} ${note.moneda}`);
    root
      .ele('cbc:DocumentCurrencyCode', {
        listID: 'ISO 4217 Alpha',
        listName: 'Currency',
        listAgencyName: 'United Nations Economic Commission for Europe',
      })
      .txt(note.moneda);
    root.ele('cbc:LineCountNumeric').txt(String(note.detalles.length));

    this.appendDiscrepancy(root, note);
    this.appendBillingReference(root, note);
    this.appendSignature(root, note);
    this.appendSupplier(root, note);
    this.appendCustomer(root, note);
    this.appendTaxTotal(root, note, note.opGravadas, note.igvMonto, '10');
    this.appendMonetaryTotal(root, note);
    note.detalles.forEach((detail, index) =>
      this.appendLine(root, note, detail, index + 1),
    );

    return root.end({ prettyPrint: false });
  }

  private appendDiscrepancy(root: XmlNode, note: CreditNoteForXml) {
    const discrepancy = root.ele('cac:DiscrepancyResponse');
    discrepancy
      .ele('cbc:ReferenceID')
      .txt(formatSunatNumber(note.serieRef, note.numeroRef));
    discrepancy
      .ele('cbc:ResponseCode', {
        listAgencyName: 'PE:SUNAT',
        listName: 'Tipo de nota de credito',
        listURI: 'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo09',
      })
      .txt(note.codigoMotivo);
    discrepancy.ele('cbc:Description').txt(note.descripcionMotivo);
  }

  private appendBillingReference(root: XmlNode, note: CreditNoteForXml) {
    const ref = root
      .ele('cac:BillingReference')
      .ele('cac:InvoiceDocumentReference');
    ref.ele('cbc:ID').txt(formatSunatNumber(note.serieRef, note.numeroRef));
    ref
      .ele('cbc:DocumentTypeCode', {
        listAgencyName: 'PE:SUNAT',
        listName: 'Tipo de Documento',
        listURI: 'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo01',
      })
      .txt(note.tipoDocumentoRef);
  }

  private appendSignature(root: XmlNode, note: CreditNoteForXml) {
    const id = `SIGN-${note.empresa.ruc}`;
    const signature = root.ele('cac:Signature');
    signature.ele('cbc:ID').txt(id);
    signature
      .ele('cac:SignatoryParty')
      .ele('cac:PartyIdentification')
      .ele('cbc:ID')
      .txt(note.empresa.ruc!);
    signature
      .ele('cac:DigitalSignatureAttachment')
      .ele('cac:ExternalReference')
      .ele('cbc:URI')
      .txt(`#${id}`);
  }

  private appendSupplier(root: XmlNode, note: CreditNoteForXml) {
    const party = root.ele('cac:AccountingSupplierParty').ele('cac:Party');
    party
      .ele('cac:PartyIdentification')
      .ele('cbc:ID', {
        schemeID: '6',
        schemeName: 'Documento de Identidad',
        schemeAgencyName: 'PE:SUNAT',
        schemeURI: 'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06',
      })
      .txt(note.empresa.ruc!);
    if (note.empresa.nombreComercial) {
      party
        .ele('cac:PartyName')
        .ele('cbc:Name')
        .txt(note.empresa.nombreComercial);
    }
    const legal = party.ele('cac:PartyLegalEntity');
    legal
      .ele('cbc:RegistrationName')
      .txt(note.empresa.razonSocial || note.empresa.nombreComercial);
    const address = legal.ele('cac:RegistrationAddress');
    address
      .ele('cbc:ID', { schemeName: 'Ubigeos', schemeAgencyName: 'PE:INEI' })
      .txt(note.sucursal?.ubigeo || '000000');
    address
      .ele('cbc:AddressTypeCode', { listName: 'Establecimientos anexos' })
      .txt(note.sucursal?.codigoEstablecimientoSunat || '0000');
    address.ele('cbc:CitySubdivisionName').txt(note.sucursal?.distrito || '-');
    address.ele('cbc:CityName').txt(note.sucursal?.distrito || '-');
    address.ele('cbc:CountrySubentity').txt(note.sucursal?.distrito || '-');
    address.ele('cbc:District').txt(note.sucursal?.distrito || '-');
    address
      .ele('cac:AddressLine')
      .ele('cbc:Line')
      .txt(note.sucursal?.direccion || note.empresa.direccion || '-');
    address
      .ele('cac:Country')
      .ele('cbc:IdentificationCode', {
        listID: 'ISO 3166-1',
        listAgencyName: 'United Nations Economic Commission for Europe',
        listName: 'Country',
      })
      .txt('PE');
  }

  private appendCustomer(root: XmlNode, note: CreditNoteForXml) {
    const party = root.ele('cac:AccountingCustomerParty').ele('cac:Party');
    party
      .ele('cac:PartyIdentification')
      .ele('cbc:ID', {
        schemeID: sunatCustomerDocumentCode(note.cliente?.tipoDocumento),
        schemeName: 'Documento de Identidad',
        schemeAgencyName: 'PE:SUNAT',
        schemeURI: 'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06',
      })
      .txt(note.cliente?.numeroDocumento || '-');
    party
      .ele('cac:PartyLegalEntity')
      .ele('cbc:RegistrationName')
      .txt(note.cliente?.razonSocial || note.cliente?.nombre || 'CLIENTE');
  }

  private appendTaxTotal(
    root: XmlNode,
    note: CreditNoteForXml,
    base: Prisma.Decimal,
    tax: Prisma.Decimal,
    afectacion: string,
  ) {
    const taxTotal = root.ele('cac:TaxTotal');
    this.currency(taxTotal, 'cbc:TaxAmount', tax, note.moneda);
    const subtotal = taxTotal.ele('cac:TaxSubtotal');
    this.currency(subtotal, 'cbc:TaxableAmount', base, note.moneda);
    this.currency(subtotal, 'cbc:TaxAmount', tax, note.moneda);
    const category = subtotal.ele('cac:TaxCategory');
    category
      .ele('cbc:ID', {
        schemeID: 'UN/ECE 5305',
        schemeName: 'Tax Category Identifier',
        schemeAgencyName: 'United Nations Economic Commission for Europe',
      })
      .txt('S');
    category.ele('cbc:Percent').txt(note.igvPorcentaje.toFixed(2));
    category
      .ele('cbc:TaxExemptionReasonCode', {
        listAgencyName: 'PE:SUNAT',
        listName: 'Afectacion del IGV',
        listURI: 'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo07',
      })
      .txt(afectacion);
    category
      .ele('cac:TaxScheme')
      .ele('cbc:ID', {
        schemeID: 'UN/ECE 5153',
        schemeName: 'Codigo de tributos',
        schemeAgencyName: 'PE:SUNAT',
      })
      .txt('1000')
      .up()
      .ele('cbc:Name')
      .txt('IGV')
      .up()
      .ele('cbc:TaxTypeCode')
      .txt('VAT');
  }

  private appendMonetaryTotal(root: XmlNode, note: CreditNoteForXml) {
    const total = root.ele('cac:LegalMonetaryTotal');
    this.currency(
      total,
      'cbc:LineExtensionAmount',
      note.opGravadas.add(note.opExoneradas).add(note.opInafectas),
      note.moneda,
    );
    this.currency(total, 'cbc:TaxInclusiveAmount', note.total, note.moneda);
    this.currency(total, 'cbc:PayableAmount', note.total, note.moneda);
  }

  private appendLine(
    root: XmlNode,
    note: CreditNoteForXml,
    detail: CreditNoteForXml['detalles'][number],
    lineNumber: number,
  ) {
    const line = root.ele('cac:CreditNoteLine');
    line.ele('cbc:ID').txt(String(lineNumber));
    line
      .ele('cbc:CreditedQuantity', { unitCode: detail.unidadMedidaCodigo })
      .txt(String(detail.cantidad));
    this.currency(
      line,
      'cbc:LineExtensionAmount',
      detail.valorVenta,
      note.moneda,
    );
    const priceRef = line
      .ele('cac:PricingReference')
      .ele('cac:AlternativeConditionPrice');
    this.currency(
      priceRef,
      'cbc:PriceAmount',
      detail.precioUnitario,
      note.moneda,
      10,
    );
    priceRef
      .ele('cbc:PriceTypeCode', {
        listName: 'Tipo de Precio',
        listAgencyName: 'PE:SUNAT',
        listURI: 'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo16',
      })
      .txt('01');
    this.appendTaxTotal(
      line,
      note,
      detail.valorVenta,
      detail.igvMonto,
      detail.tipoAfectacionIgvCodigo,
    );
    const item = line.ele('cac:Item');
    item
      .ele('cbc:Description')
      .txt(
        detail.descripcion || detail.productoVariante.producto.nombre || 'ITEM',
      );
    if (detail.productoVariante.sku) {
      item
        .ele('cac:SellersItemIdentification')
        .ele('cbc:ID')
        .txt(detail.productoVariante.sku);
    }
    const price = line.ele('cac:Price');
    this.currency(
      price,
      'cbc:PriceAmount',
      detail.valorUnitario,
      note.moneda,
      10,
    );
  }

  private currency(
    node: XmlNode,
    name: string,
    value: Prisma.Decimal,
    currency: string,
    scale = 2,
  ) {
    node.ele(name, { currencyID: currency }).txt(value.toFixed(scale));
  }

  private validate(note: CreditNoteForXml) {
    if (!note.empresa.ruc || note.empresa.ruc.length !== 11) {
      throw new BadRequestException(
        'La empresa emisora debe tener RUC de 11 digitos',
      );
    }
    if (!note.cliente) {
      throw new BadRequestException('La nota de credito debe tener cliente');
    }
    if (!note.detalles.length) {
      throw new BadRequestException('La nota de credito no tiene detalles');
    }
  }
}
