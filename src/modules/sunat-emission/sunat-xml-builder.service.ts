import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, VentaTipoComprobante } from '@prisma/client';
import { create } from 'xmlbuilder2';
import {
  formatSunatNumber,
  sunatCustomerDocumentCode,
  sunatDocumentCode,
} from './sunat-comprobante.helper';

type SunatSale = Prisma.VentaGetPayload<{
  include: {
    empresa: true;
    sucursal: true;
    cliente: true;
    detalles: {
      include: {
        productoVariante: {
          include: {
            producto: true;
          };
        };
      };
    };
  };
}>;

type XmlNode = ReturnType<typeof create>;

@Injectable()
export class SunatXmlBuilderService {
  build(sale: SunatSale) {
    this.validateSale(sale);

    const root = create({ version: '1.0', encoding: 'UTF-8' }).ele('Invoice', {
      xmlns: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
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
    });

    root
      .ele('ext:UBLExtensions')
      .ele('ext:UBLExtension')
      .ele('ext:ExtensionContent');
    root.ele('cbc:UBLVersionID').txt('2.1');
    root.ele('cbc:CustomizationID').txt('2.0');
    root
      .ele('cbc:ProfileID', {
        schemeName: 'Tipo de Operacion',
        schemeAgencyName: 'PE:SUNAT',
        schemeURI: 'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo51',
      })
      .txt('0101');
    root.ele('cbc:ID').txt(formatSunatNumber(sale.serie, sale.numero));
    root.ele('cbc:IssueDate').txt(sale.createdAt.toISOString().slice(0, 10));
    root.ele('cbc:IssueTime').txt(sale.createdAt.toISOString().slice(11, 19));
    root
      .ele('cbc:InvoiceTypeCode', {
        listAgencyName: 'PE:SUNAT',
        listName: 'Tipo de Documento',
        listURI: 'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo01',
        listID: '0101',
        listSchemeURI: 'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo51',
      })
      .txt(sunatDocumentCode(sale.tipoComprobante));
    root
      .ele('cbc:Note', { languageLocaleID: '1000' })
      .txt(`SON ${sale.total.toFixed(2)} ${sale.moneda}`);
    root
      .ele('cbc:DocumentCurrencyCode', {
        listID: 'ISO 4217 Alpha',
        listName: 'Currency',
        listAgencyName: 'United Nations Economic Commission for Europe',
      })
      .txt(sale.moneda);
    root.ele('cbc:LineCountNumeric').txt(String(sale.detalles.length));

    this.appendSignature(root, sale);
    this.appendSupplier(root, sale);
    this.appendCustomer(root, sale);
    this.appendPaymentTerms(root, sale);
    this.appendTaxTotals(root, sale);
    this.appendMonetaryTotal(root, sale);
    sale.detalles.forEach((detalle, index) =>
      this.appendLine(root, sale, detalle, index + 1),
    );

    return root.end({ prettyPrint: false });
  }

  private appendSignature(root: XmlNode, sale: SunatSale) {
    const signature = root.ele('cac:Signature');
    signature.ele('cbc:ID').txt(this.signatureId(sale));
    const signatory = signature.ele('cac:SignatoryParty');
    signatory
      .ele('cac:PartyIdentification')
      .ele('cbc:ID')
      .txt(sale.empresa.ruc!);
    signatory
      .ele('cac:PartyName')
      .ele('cbc:Name')
      .txt(sale.empresa.nombreComercial || sale.empresa.razonSocial || '');
    signature
      .ele('cac:DigitalSignatureAttachment')
      .ele('cac:ExternalReference')
      .ele('cbc:URI')
      .txt(`#${this.signatureId(sale)}`);
  }

  private appendSupplier(root: XmlNode, sale: SunatSale) {
    const party = root.ele('cac:AccountingSupplierParty').ele('cac:Party');
    party
      .ele('cac:PartyIdentification')
      .ele('cbc:ID', {
        schemeID: '6',
        schemeName: 'Documento de Identidad',
        schemeAgencyName: 'PE:SUNAT',
        schemeURI: 'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06',
      })
      .txt(sale.empresa.ruc!);

    if (sale.empresa.nombreComercial) {
      party
        .ele('cac:PartyName')
        .ele('cbc:Name')
        .txt(sale.empresa.nombreComercial);
    }

    const legal = party.ele('cac:PartyLegalEntity');
    legal
      .ele('cbc:RegistrationName')
      .txt(sale.empresa.razonSocial || sale.empresa.nombreComercial);
    const address = legal.ele('cac:RegistrationAddress');
    address
      .ele('cbc:ID', {
        schemeName: 'Ubigeos',
        schemeAgencyName: 'PE:INEI',
      })
      .txt(sale.sucursal?.ubigeo || '000000');
    address
      .ele('cbc:AddressTypeCode', { listName: 'Establecimientos anexos' })
      .txt(sale.sucursal?.codigoEstablecimientoSunat || '0000');
    address.ele('cbc:CitySubdivisionName').txt(sale.sucursal?.distrito || '-');
    address.ele('cbc:CityName').txt(sale.sucursal?.distrito || '-');
    address.ele('cbc:CountrySubentity').txt(sale.sucursal?.distrito || '-');
    address.ele('cbc:District').txt(sale.sucursal?.distrito || '-');
    address
      .ele('cac:AddressLine')
      .ele('cbc:Line')
      .txt(sale.sucursal?.direccion || sale.empresa.direccion || '-');
    address
      .ele('cac:Country')
      .ele('cbc:IdentificationCode', {
        listID: 'ISO 3166-1',
        listAgencyName: 'United Nations Economic Commission for Europe',
        listName: 'Country',
      })
      .txt('PE');
  }

  private appendCustomer(root: XmlNode, sale: SunatSale) {
    const customerName =
      sale.cliente?.razonSocial || sale.cliente?.nombre || 'CLIENTE';
    const customerDoc = sale.cliente?.numeroDocumento || '-';
    const party = root.ele('cac:AccountingCustomerParty').ele('cac:Party');
    party
      .ele('cac:PartyIdentification')
      .ele('cbc:ID', {
        schemeID: sunatCustomerDocumentCode(sale.cliente?.tipoDocumento),
        schemeName: 'Documento de Identidad',
        schemeAgencyName: 'PE:SUNAT',
        schemeURI: 'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06',
      })
      .txt(customerDoc);
    party
      .ele('cac:PartyLegalEntity')
      .ele('cbc:RegistrationName')
      .txt(customerName);
  }

  private appendPaymentTerms(root: XmlNode, sale: SunatSale) {
    if (sale.tipoComprobante !== VentaTipoComprobante.factura) {
      return;
    }

    const terms = root.ele('cac:PaymentTerms');
    terms.ele('cbc:ID').txt('FormaPago');
    terms
      .ele('cbc:PaymentMeansID')
      .txt(sale.formaPago.toUpperCase() === 'CREDITO' ? 'Credito' : 'Contado');
  }

  private appendTaxTotals(root: XmlNode, sale: SunatSale) {
    const taxTotal = root.ele('cac:TaxTotal');
    this.currency(taxTotal, 'cbc:TaxAmount', sale.igvMonto, sale.moneda);

    if (sale.opGravadas.gt(0) || sale.igvMonto.gt(0)) {
      this.appendTaxSubtotal(
        root,
        taxTotal,
        sale,
        sale.opGravadas,
        sale.igvMonto,
        '10',
      );
    }

    if (sale.opExoneradas.gt(0)) {
      this.appendTaxSubtotal(
        root,
        taxTotal,
        sale,
        sale.opExoneradas,
        new Prisma.Decimal(0),
        '20',
      );
    }

    if (sale.opInafectas.gt(0)) {
      this.appendTaxSubtotal(
        root,
        taxTotal,
        sale,
        sale.opInafectas,
        new Prisma.Decimal(0),
        '30',
      );
    }
  }

  private appendTaxSubtotal(
    root: XmlNode,
    taxTotal: XmlNode,
    sale: SunatSale,
    base: Prisma.Decimal,
    tax: Prisma.Decimal,
    afectacion: string,
  ) {
    const taxData = this.taxSchemeData(afectacion);
    const subtotal = taxTotal.ele('cac:TaxSubtotal');
    this.currency(subtotal, 'cbc:TaxableAmount', base, sale.moneda);
    this.currency(subtotal, 'cbc:TaxAmount', tax, sale.moneda);
    const category = subtotal.ele('cac:TaxCategory');
    category
      .ele('cbc:ID', {
        schemeID: 'UN/ECE 5305',
        schemeName: 'Tax Category Identifier',
        schemeAgencyName: 'United Nations Economic Commission for Europe',
      })
      .txt(taxData.category);
    if (taxData.percent) {
      category.ele('cbc:Percent').txt(sale.igvPorcentaje.toFixed(2));
    }
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
      .txt(taxData.id)
      .up()
      .ele('cbc:Name')
      .txt(taxData.name)
      .up()
      .ele('cbc:TaxTypeCode')
      .txt(taxData.type);
  }

  private appendMonetaryTotal(root: XmlNode, sale: SunatSale) {
    const lineExtension = sale.opGravadas
      .add(sale.opExoneradas)
      .add(sale.opInafectas);
    const total = root.ele('cac:LegalMonetaryTotal');
    this.currency(total, 'cbc:LineExtensionAmount', lineExtension, sale.moneda);
    this.currency(total, 'cbc:TaxInclusiveAmount', sale.total, sale.moneda);
    this.currency(total, 'cbc:PayableAmount', sale.total, sale.moneda);
  }

  private appendLine(
    root: XmlNode,
    sale: SunatSale,
    detalle: SunatSale['detalles'][number],
    lineNumber: number,
  ) {
    const line = root.ele('cac:InvoiceLine');
    line.ele('cbc:ID').txt(String(lineNumber));
    line
      .ele('cbc:InvoicedQuantity', { unitCode: detalle.unidadMedidaCodigo })
      .txt(String(detalle.cantidad));
    this.currency(
      line,
      'cbc:LineExtensionAmount',
      detalle.valorVenta,
      sale.moneda,
    );

    const priceWithIgv =
      detalle.cantidad > 0
        ? detalle.total.div(detalle.cantidad).toDecimalPlaces(10)
        : detalle.precioUnitario;
    const priceRef = line
      .ele('cac:PricingReference')
      .ele('cac:AlternativeConditionPrice');
    this.currency(priceRef, 'cbc:PriceAmount', priceWithIgv, sale.moneda, 10);
    priceRef
      .ele('cbc:PriceTypeCode', {
        listName: 'Tipo de Precio',
        listAgencyName: 'PE:SUNAT',
        listURI: 'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo16',
      })
      .txt('01');

    const discountBase = detalle.valorUnitario
      .mul(detalle.cantidad)
      .toDecimalPlaces(2);
    const discountWithoutIgv = discountBase
      .sub(detalle.valorVenta)
      .toDecimalPlaces(2);
    if (discountWithoutIgv.gt(0)) {
      const allowance = line.ele('cac:AllowanceCharge');
      allowance.ele('cbc:ChargeIndicator').txt('false');
      allowance
        .ele('cbc:AllowanceChargeReasonCode', {
          listAgencyName: 'PE:SUNAT',
          listName: 'Cargo/descuento',
          listURI: 'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo53',
        })
        .txt('00');
      allowance
        .ele('cbc:MultiplierFactorNumeric')
        .txt(
          discountWithoutIgv.div(discountBase).toDecimalPlaces(5).toString(),
        );
      this.currency(allowance, 'cbc:Amount', discountWithoutIgv, sale.moneda);
      this.currency(allowance, 'cbc:BaseAmount', discountBase, sale.moneda);
    }

    const taxTotal = line.ele('cac:TaxTotal');
    this.currency(taxTotal, 'cbc:TaxAmount', detalle.igvMonto, sale.moneda);
    this.appendTaxSubtotal(
      root,
      taxTotal,
      sale,
      detalle.valorVenta,
      detalle.igvMonto,
      detalle.tipoAfectacionIgvCodigo,
    );

    const item = line.ele('cac:Item');
    item
      .ele('cbc:Description')
      .txt(
        detalle.descripcion ||
          detalle.productoVariante.producto.nombre ||
          'ITEM',
      );
    if (detalle.productoVariante.sku) {
      item
        .ele('cac:SellersItemIdentification')
        .ele('cbc:ID')
        .txt(detalle.productoVariante.sku);
    }

    const price = line.ele('cac:Price');
    this.currency(
      price,
      'cbc:PriceAmount',
      detalle.valorUnitario,
      sale.moneda,
      10,
    );
  }

  private currency(
    parent: XmlNode,
    name: string,
    amount: Prisma.Decimal,
    moneda: string,
    scale = 2,
  ) {
    parent.ele(name, { currencyID: moneda }).txt(amount.toFixed(scale));
  }

  private validateSale(sale: SunatSale) {
    if (!sale.empresa.ruc || sale.empresa.ruc.length !== 11) {
      throw new BadRequestException(
        'La empresa emisora debe tener RUC de 11 digitos',
      );
    }

    if (!sale.empresa.razonSocial && !sale.empresa.nombreComercial) {
      throw new BadRequestException(
        'La empresa emisora debe tener razon social',
      );
    }

    if (!sale.sucursal?.ubigeo || sale.sucursal.ubigeo.length !== 6) {
      throw new BadRequestException(
        'La sucursal emisora debe tener ubigeo de 6 digitos',
      );
    }
  }

  private taxSchemeData(afectacion: string) {
    if (afectacion.startsWith('2')) {
      return {
        category: 'E',
        id: '9997',
        name: 'EXO',
        type: 'VAT',
        percent: false,
      };
    }

    if (afectacion.startsWith('3')) {
      return {
        category: 'O',
        id: '9998',
        name: 'INA',
        type: 'FRE',
        percent: false,
      };
    }

    return {
      category: 'S',
      id: '1000',
      name: 'IGV',
      type: 'VAT',
      percent: true,
    };
  }

  private signatureId(sale: SunatSale) {
    return `SIGN-${sale.empresa.ruc}`;
  }
}
