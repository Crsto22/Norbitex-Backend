import { PlanCodigo } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PlansService } from '../plans/plans.service';
import { SunatConfigService } from '../sunat-config/sunat-config.service';
import { PlatformSunatService } from './platform-sunat.service';

describe('PlatformSunatService', () => {
  it('returns a lightweight paginated company list', async () => {
    const company = {
      id: 1n,
      nombreComercial: 'Nuvex Demo',
      razonSocial: 'Nuvex Demo SAC',
      ruc: '20123456789',
      dni: null,
      email: 'demo@nuvex.test',
      estado: 'activa',
      planCodigo: PlanCodigo.empresarial,
    };
    const findManySunatConfigs = jest.fn();
    const prisma = {
      empresa: {
        findMany: jest.fn().mockResolvedValue([company]),
        count: jest.fn().mockResolvedValue(1),
      },
      sunatEndpointConfig: {
        findMany: findManySunatConfigs,
      },
    } as unknown as PrismaService;

    const result = await new PlatformSunatService(
      prisma,
      new PlansService({} as PrismaService),
      {} as SunatConfigService,
    ).findCompanies({});

    expect(result.data[0]).toEqual({
      id: '1',
      name: 'Nuvex Demo',
      legalName: 'Nuvex Demo SAC',
      document: '20123456789',
      email: 'demo@nuvex.test',
      state: 'activa',
      planCode: PlanCodigo.empresarial,
      planName: 'Escala',
    });
    expect(result.meta).toEqual({
      page: 1,
      limit: 12,
      total: 1,
      totalPages: 1,
    });
    expect(findManySunatConfigs).not.toHaveBeenCalled();
  });
});
