import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LocalPdfLogoStorageService } from '../storage/local-pdf-logo-storage.service';
import { R2StorageService } from '../storage/r2-storage.service';
import { CompanyService } from './company.service';

describe('CompanyService', () => {
  const updatedCompany = {
    id: 1n,
    nombreComercial: 'Kiments',
    razonSocial: 'Kiments SAC',
    ruc: '20615136663',
    dni: null,
    telefono: null,
    email: null,
    direccion: null,
    logoUrl: null,
    logoPdfUrl: null,
    comoConocio: null,
    comoConocioOtro: null,
    estado: 'activa',
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
  };

  function createService() {
    const tx = {
      empresa: {
        findUnique: jest.fn().mockResolvedValue({ dni: '12345678', ruc: null }),
        update: jest.fn((args: unknown) => {
          void args;
          return Promise.resolve(updatedCompany);
        }),
      },
    };
    const runTransaction = async <T>(
      callback: (client: typeof tx) => Promise<T>,
    ) => callback(tx);
    const prisma = {
      sucursal: { count: jest.fn() },
      $transaction: jest.fn(runTransaction),
    };
    const service = new CompanyService(
      prisma as unknown as PrismaService,
      {} as R2StorageService,
      {} as LocalPdfLogoStorageService,
    );

    return { service, prisma, tx };
  }

  it('replaces DNI when converting the company to RUC', async () => {
    const { service, tx } = createService();

    await service.update(1n, {
      ruc: '20615136663',
      razonSocial: 'Kiments SAC',
    });

    const updateCall = tx.empresa.update.mock.calls[0][0] as {
      data: Record<string, unknown>;
    };
    expect(updateCall.data).toMatchObject({
      dni: null,
      ruc: '20615136663',
      razonSocial: 'Kiments SAC',
    });
  });

  it('requires a legal name during DNI to RUC conversion', async () => {
    const { service } = createService();

    await expect(
      service.update(1n, { ruc: '20615136663' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('tracks POS and attendance branches separately for onboarding', async () => {
    const { service, prisma } = createService();
    prisma.sucursal.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);

    await expect(service.getSetupStatus(1n)).resolves.toEqual({
      hasActiveBranch: false,
      hasActiveAttendanceBranch: true,
      hasAnyActiveBranch: true,
      requiresBranch: true,
    });
    await expect(service.getSetupStatus(1n)).resolves.toEqual({
      hasActiveBranch: true,
      hasActiveAttendanceBranch: false,
      hasAnyActiveBranch: true,
      requiresBranch: false,
    });
  });
});
