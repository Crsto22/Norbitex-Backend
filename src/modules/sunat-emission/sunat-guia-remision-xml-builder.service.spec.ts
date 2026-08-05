import { Prisma } from '@prisma/client';
import {
  type SunatGuia,
  SunatGuiaRemisionXmlBuilderService,
} from './sunat-guia-remision-xml-builder.service';

describe('SunatGuiaRemisionXmlBuilderService', () => {
  it('genera una GRE remitente UBL con traslado, conductor y producto', () => {
    const xml = new SunatGuiaRemisionXmlBuilderService().build({
      serie: 'T001',
      numero: 7,
      fechaEmision: new Date('2026-08-04T00:00:00.000Z'),
      createdAt: new Date('2026-08-04T15:30:00.000Z'),
      fechaInicioTraslado: new Date('2026-08-05T00:00:00.000Z'),
      fechaEntregaTransportista: null,
      motivoTraslado: '04',
      descripcionMotivo: 'Traslado entre establecimientos',
      modalidadTransporte: '02',
      pesoBrutoTotal: new Prisma.Decimal('12.500'),
      unidadPeso: 'KGM',
      numeroBultos: 2,
      observaciones: null,
      ubigeoPartida: '150101',
      direccionPartida: 'Av. Origen 100',
      ubigeoLlegada: '150102',
      direccionLlegada: 'Av. Destino 200',
      destinatarioTipoDoc: '6',
      destinatarioNroDoc: '20111111111',
      destinatarioRazonSocial: 'CLIENTE SAC',
      empresa: {
        ruc: '20615136663',
        razonSocial: 'KIMENTS SAC',
        nombreComercial: 'Kiments',
      },
      sucursalPartida: { codigoEstablecimientoSunat: '0000' },
      sucursalLlegada: { codigoEstablecimientoSunat: '0001' },
      documentosRelacionados: [],
      participantes: [
        {
          tipo: 'conductor',
          tipoDocumento: '1',
          numeroDocumento: '12345678',
          nombres: 'JUAN',
          apellidos: 'PEREZ',
          licencia: 'Q12345678',
          registroMtc: null,
          razonSocial: null,
          esPrincipal: true,
        },
      ],
      vehiculos: [{ placa: 'ABC123', esPrincipal: true }],
      detalles: [
        {
          cantidad: new Prisma.Decimal('3'),
          unidadMedida: 'NIU',
          descripcion: 'POLO AZUL M',
          codigoProducto: 'SKU-1',
          productoVariante: { sku: 'SKU-1' },
        },
      ],
    } as unknown as SunatGuia);

    expect(xml).toContain('<DespatchAdvice');
    expect(xml).toContain('<cbc:ID>T001-00000007</cbc:ID>');
    expect(xml).toContain('<cbc:HandlingCode');
    expect(xml).toContain('ABC123');
    expect(xml).toContain('POLO AZUL M');
  });
});
