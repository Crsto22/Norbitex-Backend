import { SunatAmbiente, SunatEstado } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import {
  buildCompanySunatR2Key,
  buildPlatformSunatR2Key,
  R2StorageService,
} from './r2-storage.service';
import {
  sunatMetadataBody,
  sunatMetadataState,
} from '../sunat-emission/sunat-document-storage.service';

describe('R2 SUNAT storage', () => {
  const fecha = new Date(2026, 7, 4);

  it('separa BETA y PRODUCCION en las rutas de empresa y plataforma', () => {
    const beta = buildCompanySunatR2Key({
      empresaId: 15n,
      ambiente: SunatAmbiente.BETA,
      tipo: 'facturas',
      fecha,
      fileName: '20615136663-01-F001-00000001.xml',
    });
    const production = buildCompanySunatR2Key({
      empresaId: 15n,
      ambiente: SunatAmbiente.PRODUCCION,
      tipo: 'facturas',
      fecha,
      fileName: '20615136663-01-F001-00000001.xml',
    });

    expect(beta).toContain('/BETA/ventas/facturas/2026/08/');
    expect(production).toContain('/PRODUCCION/ventas/facturas/2026/08/');
    expect(beta).not.toBe(production);
    for (const tipo of [
      'facturas',
      'boletas',
      'notas-credito',
      'guias-remision',
      'bajas-ra',
      'bajas-rc',
    ]) {
      expect(
        buildCompanySunatR2Key({
          empresaId: 15n,
          ambiente: SunatAmbiente.BETA,
          tipo,
          fecha,
          fileName: 'x.xml',
        }),
      ).toContain(`/BETA/ventas/${tipo}/`);
    }
    expect(
      buildPlatformSunatR2Key({
        ambiente: SunatAmbiente.BETA,
        tipo: 'boletas',
        fecha,
        fileName: 'x.xml',
      }),
    ).toBe('sunat/plataforma/BETA/boletas/2026/08/x.xml');
  });

  it('firma las descargas usando solo el bucket privado', async () => {
    const service = new R2StorageService(
      new ConfigService({
        CLOUDFLARE_R2_ACCOUNT_ID: 'account',
        CLOUDFLARE_R2_ACCESS_KEY_ID: 'access',
        CLOUDFLARE_R2_SECRET_ACCESS_KEY: 'secret',
        CLOUDFLARE_R2_PUBLIC_BUCKET: 'norbitex-public',
        CLOUDFLARE_R2_PRIVATE_BUCKET: 'norbitex-private',
      }),
    );

    const url = await service.getSignedSunatDocumentUrl(
      'sunat/empresa-15/BETA/ventas/facturas/2026/08/x.xml',
      'x.xml',
    );

    expect(url).toContain('norbitex-private');
    expect(url).toContain('X-Amz-Signature=');
    expect(url).not.toContain('norbitex-public');
  });

  it('serializa metadata pendiente y el estado final del CDR', () => {
    const pending = JSON.parse(
      sunatMetadataBody({
        ambiente: SunatAmbiente.BETA,
        tipoDoc: '01',
        serie: 'F001',
        correlativo: '00000001',
        ticket: null,
        estado: 'PENDIENTE',
        fechaEmision: '2026-08-04',
        fechaEnvio: '2026-08-04T15:00:00.000Z',
        fechaProcesado: null,
      }).toString(),
    ) as { estado: string };

    expect(pending.estado).toBe('PENDIENTE');
    expect(sunatMetadataState(SunatEstado.aceptado)).toBe('ACEPTADA');
    expect(sunatMetadataState(SunatEstado.observado)).toBe('OBSERVADA');
    expect(sunatMetadataState(SunatEstado.rechazado)).toBe('RECHAZADA');
  });
});
