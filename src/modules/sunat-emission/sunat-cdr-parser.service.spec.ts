import { SunatEstado } from '@prisma/client';
import JSZip from 'jszip';
import { SunatCdrParserService } from './sunat-cdr-parser.service';

describe('SunatCdrParserService', () => {
  const service = new SunatCdrParserService();

  it('interpreta CDR aceptado', async () => {
    const result = await service.parse(await buildCdrZip('0', 'Aceptado'));

    expect(result.estado).toBe(SunatEstado.aceptado);
    expect(result.codigo).toBe('0');
  });

  it('interpreta CDR observado cuando hay notas', async () => {
    const result = await service.parse(
      await buildCdrZip('0', 'Aceptado', '<cbc:Note>Observacion</cbc:Note>'),
    );

    expect(result.estado).toBe(SunatEstado.observado);
    expect(result.mensaje).toContain('Observacion');
  });

  it('interpreta CDR rechazado', async () => {
    const result = await service.parse(await buildCdrZip('1234', 'Rechazado'));

    expect(result.estado).toBe(SunatEstado.rechazado);
    expect(result.codigo).toBe('1234');
  });
});

async function buildCdrZip(code: string, description: string, note = '') {
  const zip = new JSZip();
  zip.file(
    'R-20123456789-01-F001-00000001.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<ApplicationResponse xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ResponseCode>${code}</cbc:ResponseCode>
  <cbc:Description>${description}</cbc:Description>
  ${note}
</ApplicationResponse>`,
  );

  return zip.generateAsync({ type: 'nodebuffer' });
}
