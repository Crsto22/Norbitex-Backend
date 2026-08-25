import { PlanCodigo, Prisma, SunatAmbiente } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PlansService } from '../plans/plans.service';
import { SunatConfigService } from '../sunat-config/sunat-config.service';
import { PlatformSunatService } from './platform-sunat.service';

describe('PlatformSunatService', () => {
  it('returns readiness without exposing encrypted secrets', async () => {
    const company = {
      id: 1n,
      nombreComercial: 'Nuvex Demo',
      razonSocial: 'Nuvex Demo SAC',
      ruc: '20123456789',
      dni: null,
      email: 'demo@nuvex.test',
      direccion: 'Av. Principal 123',
      estado: 'activa',
      planCodigo: PlanCodigo.empresarial,
      sunatConfig: {
        ambiente: SunatAmbiente.PRODUCCION,
        usuarioSolEncrypted: 'encrypted-user',
        claveSolEncrypted: 'encrypted-password',
        clientIdEncrypted: 'encrypted-client-id',
        clientSecretEncrypted: 'encrypted-client-secret',
        certificadoPasswordEncrypted: 'encrypted-cert-password',
        certificadoR2Key: 'certificates/1/demo.pfx',
        certificadoNombre: 'demo.pfx',
        certificadoMimeType: 'application/x-pkcs12',
        certificadoSizeBytes: 1024,
        certificadoUploadedAt: new Date('2026-08-25T10:00:00.000Z'),
        igvPorcentaje: new Prisma.Decimal('18.00'),
        activo: true,
        updatedAt: new Date('2026-08-25T10:00:00.000Z'),
      },
    };
    const prisma = {
      empresa: {
        findMany: jest.fn().mockResolvedValue([company]),
        count: jest.fn().mockResolvedValue(1),
      },
      sunatEndpointConfig: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ ambiente: SunatAmbiente.PRODUCCION }]),
      },
    } as unknown as PrismaService;

    const result = await new PlatformSunatService(
      prisma,
      new PlansService({} as PrismaService),
      {} as SunatConfigService,
    ).findCompanies({});

    expect(result.data[0].readiness.ready).toBe(true);
    expect(result.data[0].sunat.usuarioSolConfigurado).toBe(true);
    expect(JSON.stringify(result)).not.toContain('encrypted-user');
    expect(JSON.stringify(result)).not.toContain('encrypted-password');
    expect(JSON.stringify(result)).not.toContain('certificates/1/demo.pfx');
  });
});
