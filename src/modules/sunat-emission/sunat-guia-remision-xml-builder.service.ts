import { BadRequestException, Injectable } from '@nestjs/common';
import { GuiaRemisionParticipanteTipo, Prisma } from '@prisma/client';
import { create } from 'xmlbuilder2';

type XmlNode = ReturnType<typeof create>;

export const sunatGuiaInclude = {
  empresa: true,
  sucursal: true,
  sucursalPartida: true,
  sucursalLlegada: true,
  detalles: {
    include: { productoVariante: true },
    orderBy: { id: 'asc' },
  },
  documentosRelacionados: { orderBy: { id: 'asc' } },
  participantes: { orderBy: [{ esPrincipal: 'desc' }, { id: 'asc' }] },
  vehiculos: { orderBy: [{ esPrincipal: 'desc' }, { id: 'asc' }] },
} satisfies Prisma.GuiaRemisionInclude;

export type SunatGuia = Prisma.GuiaRemisionGetPayload<{
  include: typeof sunatGuiaInclude;
}>;

const CAC =
  'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2';
const CBC =
  'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2';
const ALLOWED_REASONS = new Set([
  '01',
  '02',
  '03',
  '04',
  '05',
  '06',
  '07',
  '13',
  '14',
  '17',
]);

@Injectable()
export class SunatGuiaRemisionXmlBuilderService {
  build(guia: SunatGuia) {
    this.validate(guia);
    const root = create({ version: '1.0', encoding: 'UTF-8' }).ele(
      'DespatchAdvice',
      {
        xmlns: 'urn:oasis:names:specification:ubl:schema:xsd:DespatchAdvice-2',
        'xmlns:cac': CAC,
        'xmlns:cbc': CBC,
        'xmlns:ext':
          'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2',
        'xmlns:ds': 'http://www.w3.org/2000/09/xmldsig#',
      },
    );

    root
      .ele('ext:UBLExtensions')
      .ele('ext:UBLExtension')
      .ele('ext:ExtensionContent');
    this.text(root, 'cbc:UBLVersionID', '2.1');
    this.text(root, 'cbc:CustomizationID', '2.0');
    this.text(root, 'cbc:ID', this.guideNumber(guia));
    this.text(root, 'cbc:IssueDate', this.date(guia.fechaEmision));
    this.text(root, 'cbc:IssueTime', this.limaTime(guia.createdAt));
    this.text(root, 'cbc:DespatchAdviceTypeCode', '09', {
      listAgencyName: 'PE:SUNAT',
      listName: 'Tipo de Documento',
      listURI: 'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo01',
    });
    if (guia.observaciones?.trim()) {
      this.text(root, 'cbc:Note', guia.observaciones.trim());
    }

    this.relatedDocuments(root, guia);
    this.signature(root, guia);
    this.supplier(root, guia);
    this.customer(root, guia);
    this.shipment(root, guia);
    guia.detalles.forEach((detail, index) =>
      this.line(root, detail, index + 1),
    );

    return root.end({ prettyPrint: false });
  }

  private relatedDocuments(root: XmlNode, guia: SunatGuia) {
    for (const document of guia.documentosRelacionados) {
      const reference = root.ele('cac:AdditionalDocumentReference');
      this.text(reference, 'cbc:ID', `${document.serie}-${document.numero}`);
      this.text(reference, 'cbc:DocumentTypeCode', document.tipoDocumento, {
        listAgencyName: 'PE:SUNAT',
        listName: 'Documento relacionado al transporte',
        listURI: 'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo61',
      });
      this.text(
        reference,
        'cbc:DocumentType',
        document.tipoDocumento === '01'
          ? 'Factura'
          : document.tipoDocumento === '03'
            ? 'Boleta de venta'
            : 'Documento relacionado',
      );
      const issuer = reference
        .ele('cac:IssuerParty')
        .ele('cac:PartyIdentification');
      this.identity(issuer, guia.empresa.ruc!, '6');
    }
  }

  private signature(root: XmlNode, guia: SunatGuia) {
    const signatureId = `SIGN-${guia.empresa.ruc}`;
    const signature = root.ele('cac:Signature');
    this.text(signature, 'cbc:ID', signatureId);
    const party = signature.ele('cac:SignatoryParty');
    this.text(
      party.ele('cac:PartyIdentification'),
      'cbc:ID',
      guia.empresa.ruc!,
    );
    this.text(
      party.ele('cac:PartyName'),
      'cbc:Name',
      guia.empresa.nombreComercial || guia.empresa.razonSocial!,
    );
    this.text(
      signature
        .ele('cac:DigitalSignatureAttachment')
        .ele('cac:ExternalReference'),
      'cbc:URI',
      `#${signatureId}`,
    );
  }

  private supplier(root: XmlNode, guia: SunatGuia) {
    const party = root.ele('cac:DespatchSupplierParty').ele('cac:Party');
    this.identity(party.ele('cac:PartyIdentification'), guia.empresa.ruc!, '6');
    this.text(
      party.ele('cac:PartyLegalEntity'),
      'cbc:RegistrationName',
      guia.empresa.razonSocial!,
    );
  }

  private customer(root: XmlNode, guia: SunatGuia) {
    const party = root.ele('cac:DeliveryCustomerParty').ele('cac:Party');
    this.identity(
      party.ele('cac:PartyIdentification'),
      guia.destinatarioNroDoc,
      guia.destinatarioTipoDoc,
    );
    this.text(
      party.ele('cac:PartyLegalEntity'),
      'cbc:RegistrationName',
      guia.destinatarioRazonSocial,
    );
  }

  private shipment(root: XmlNode, guia: SunatGuia) {
    const shipment = root.ele('cac:Shipment');
    this.text(shipment, 'cbc:ID', '1');
    this.text(shipment, 'cbc:HandlingCode', guia.motivoTraslado, {
      listAgencyName: 'PE:SUNAT',
      listName: 'Motivo de traslado',
      listURI: 'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo20',
    });
    if (guia.descripcionMotivo?.trim()) {
      this.text(
        shipment,
        'cbc:HandlingInstructions',
        guia.descripcionMotivo.trim(),
      );
    }
    this.text(
      shipment,
      'cbc:GrossWeightMeasure',
      guia.pesoBrutoTotal.toFixed(3),
      { unitCode: guia.unidadPeso || 'KGM' },
    );
    if (guia.numeroBultos && guia.numeroBultos > 0) {
      this.text(
        shipment,
        'cbc:TotalTransportHandlingUnitQuantity',
        guia.numeroBultos.toString(),
      );
    }

    const stage = shipment.ele('cac:ShipmentStage');
    this.text(stage, 'cbc:TransportModeCode', guia.modalidadTransporte, {
      listName: 'Modalidad de traslado',
      listAgencyName: 'PE:SUNAT',
      listURI: 'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo18',
    });
    this.text(
      stage.ele('cac:TransitPeriod'),
      'cbc:StartDate',
      this.date(guia.fechaInicioTraslado),
    );

    if (guia.modalidadTransporte === '01') {
      this.text(
        stage.ele('cac:LoadingTransportEvent'),
        'cbc:OccurrenceDate',
        this.date(guia.fechaEntregaTransportista!),
      );
      for (const carrier of guia.participantes.filter(
        (item) => item.tipo === GuiaRemisionParticipanteTipo.transportista,
      )) {
        const party = stage.ele('cac:CarrierParty');
        this.identity(
          party.ele('cac:PartyIdentification'),
          carrier.numeroDocumento,
          carrier.tipoDocumento,
        );
        const legal = party.ele('cac:PartyLegalEntity');
        this.text(
          legal,
          'cbc:RegistrationName',
          carrier.razonSocial ||
            `${carrier.nombres ?? ''} ${carrier.apellidos ?? ''}`.trim(),
        );
        if (carrier.registroMtc) {
          this.text(legal, 'cbc:CompanyID', carrier.registroMtc);
        }
      }
    } else {
      for (const driver of guia.participantes.filter(
        (item) => item.tipo === GuiaRemisionParticipanteTipo.conductor,
      )) {
        const person = stage.ele('cac:DriverPerson');
        this.text(person, 'cbc:ID', driver.numeroDocumento, {
          schemeID: driver.tipoDocumento,
          schemeName: 'Documento de Identidad',
          schemeAgencyName: 'PE:SUNAT',
          schemeURI: 'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06',
        });
        this.text(person, 'cbc:FirstName', driver.nombres ?? '');
        this.text(person, 'cbc:FamilyName', driver.apellidos ?? '');
        this.text(
          person,
          'cbc:JobTitle',
          driver.esPrincipal ? 'Principal' : 'Secundario',
        );
        this.text(
          person.ele('cac:IdentityDocumentReference'),
          'cbc:ID',
          driver.licencia ?? '',
        );
      }
    }

    const delivery = shipment.ele('cac:Delivery');
    this.address(
      delivery.ele('cac:DeliveryAddress'),
      guia.ubigeoLlegada,
      guia.direccionLlegada,
      guia.sucursalLlegada?.codigoEstablecimientoSunat,
      guia.empresa.ruc!,
    );
    this.address(
      delivery.ele('cac:Despatch').ele('cac:DespatchAddress'),
      guia.ubigeoPartida,
      guia.direccionPartida,
      guia.sucursalPartida?.codigoEstablecimientoSunat,
      guia.empresa.ruc!,
    );

    if (guia.modalidadTransporte === '02') {
      for (const vehicle of guia.vehiculos) {
        this.text(
          shipment
            .ele('cac:TransportHandlingUnit')
            .ele('cac:TransportEquipment'),
          'cbc:ID',
          vehicle.placa,
        );
      }
    }
  }

  private line(
    root: XmlNode,
    detail: SunatGuia['detalles'][number],
    number: number,
  ) {
    const line = root.ele('cac:DespatchLine');
    this.text(line, 'cbc:ID', number.toString());
    this.text(line, 'cbc:DeliveredQuantity', detail.cantidad.toFixed(3), {
      unitCode: detail.unidadMedida || 'NIU',
    });
    this.text(
      line.ele('cac:OrderLineReference'),
      'cbc:LineID',
      number.toString(),
    );
    const item = line.ele('cac:Item');
    this.text(item, 'cbc:Description', detail.descripcion);
    const code = detail.codigoProducto || detail.productoVariante?.sku;
    if (code) {
      this.text(item.ele('cac:SellersItemIdentification'), 'cbc:ID', code);
    }
  }

  private address(
    node: XmlNode,
    ubigeo: string,
    address: string,
    establishmentCode: string | null | undefined,
    ruc: string,
  ) {
    this.text(node, 'cbc:ID', ubigeo, {
      schemeName: 'Ubigeos',
      schemeAgencyName: 'PE:INEI',
    });
    if (establishmentCode) {
      this.text(node, 'cbc:AddressTypeCode', establishmentCode, {
        listAgencyName: 'PE:SUNAT',
        listName: 'Establecimientos anexos',
        listID: ruc,
      });
    }
    this.text(node.ele('cac:AddressLine'), 'cbc:Line', address);
  }

  private identity(node: XmlNode, document: string, type: string) {
    this.text(node, 'cbc:ID', document, {
      schemeID: type,
      schemeName: 'Documento de Identidad',
      schemeAgencyName: 'PE:SUNAT',
      schemeURI: 'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo06',
    });
  }

  private text(
    parent: XmlNode,
    name: string,
    value: string,
    attributes?: Record<string, string>,
  ) {
    parent.ele(name, attributes).txt(value).up();
  }

  private validate(guia: SunatGuia) {
    if (!guia.detalles.length) {
      throw new BadRequestException('La guia no tiene productos');
    }
    if (!/^\d{11}$/.test(guia.empresa.ruc ?? '')) {
      throw new BadRequestException('La empresa emisora debe tener RUC valido');
    }
    if (!guia.empresa.razonSocial?.trim()) {
      throw new BadRequestException('La empresa no tiene razon social');
    }
    if (!ALLOWED_REASONS.has(guia.motivoTraslado)) {
      throw new BadRequestException('Motivo de traslado no permitido');
    }
    if (guia.modalidadTransporte === '01' && !guia.fechaEntregaTransportista) {
      throw new BadRequestException(
        'La guia con transporte publico requiere fecha de entrega',
      );
    }
  }

  private guideNumber(guia: SunatGuia) {
    return `${guia.serie}-${guia.numero.toString().padStart(8, '0')}`;
  }

  private date(value: Date) {
    return value.toISOString().slice(0, 10);
  }

  private limaTime(value: Date) {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/Lima',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(value);
  }
}
