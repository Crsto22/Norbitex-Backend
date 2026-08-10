import { AfiliadoEstado, Prisma } from '@prisma/client';
import {
  calculateAffiliatePricing,
  getLimaPeriod,
  PlatformAffiliatesService,
} from './platform-affiliates.service';

describe('affiliate pricing', () => {
  it('applies the affiliate discount before calculating commission', () => {
    const result = calculateAffiliatePricing(
      new Prisma.Decimal('100.00'),
      new Prisma.Decimal('10.00'),
      new Prisma.Decimal('20.00'),
    );

    expect(result.discountAmount.toFixed(2)).toBe('10.00');
    expect(result.total.toFixed(2)).toBe('90.00');
    expect(result.commissionAmount.toFixed(2)).toBe('18.00');
  });

  it('uses the Lima calendar month', () => {
    expect(getLimaPeriod(new Date('2026-08-01T03:00:00.000Z'))).toBe('2026-07');
  });

  it('generates the monthly affiliate payment guide', async () => {
    const prisma = {
      liquidacionAfiliado: {
        findUnique: jest.fn().mockResolvedValue({
          estado: 'pendiente',
          periodo: '2026-07',
          cantidad: 1,
          montoTotal: new Prisma.Decimal('16.20'),
          metodoPago: null,
          referenciaPago: null,
          afiliado: {
            codigo: 'KIMENTS',
            nombre: 'Kiments',
            documento: '20615136663',
            email: 'afiliado@example.com',
            telefono: null,
          },
          comisiones: [
            {
              baseCalculo: new Prisma.Decimal('81.00'),
              porcentaje: new Prisma.Decimal('20.00'),
              monto: new Prisma.Decimal('16.20'),
              empresa: {
                nombreComercial: 'Empresa afiliada',
                razonSocial: null,
                ruc: null,
                dni: '12345678',
              },
              pagoSuscripcion: {
                planCodigo: 'emprendedor',
                meses: 1,
                createdAt: new Date('2026-07-10T15:00:00.000Z'),
              },
            },
          ],
        }),
      },
    };
    const service = new PlatformAffiliatesService(prisma as never);

    const result = await service.generateSettlementPdf('1');

    expect(result.fileName).toBe('guia-pago-KIMENTS-2026-07.pdf');
    expect(result.buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('validates a public active affiliate code without exposing private fields', async () => {
    const prisma = {
      afiliado: {
        findUnique: jest.fn().mockResolvedValue({
          codigo: 'NOBI10',
          descuentoPorcentaje: new Prisma.Decimal('10'),
          estado: AfiliadoEstado.activo,
          comisionPorcentaje: new Prisma.Decimal('20'),
          email: 'afiliado@example.com',
        }),
      },
    };
    const service = new PlatformAffiliatesService(prisma as never);

    const result = await service.validatePublicCode(' nobi10 ');

    expect(prisma.afiliado.findUnique).toHaveBeenCalledWith({
      where: { codigoKey: 'NOBI10' },
      select: {
        codigo: true,
        descuentoPorcentaje: true,
        estado: true,
      },
    });
    expect(result).toEqual({
      valid: true,
      code: 'NOBI10',
      discountPercent: '10.00',
      currency: 'PEN',
    });
    expect(result).not.toHaveProperty('commissionPercent');
    expect(result).not.toHaveProperty('email');
  });

  it('returns invalid for a missing public affiliate code', async () => {
    const prisma = {
      afiliado: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const service = new PlatformAffiliatesService(prisma as never);

    await expect(service.validatePublicCode('NOPE')).resolves.toEqual({
      valid: false,
      code: 'NOPE',
      discountPercent: '0.00',
      reason: 'invalid',
    });
  });

  it('returns inactive for an inactive public affiliate code', async () => {
    const prisma = {
      afiliado: {
        findUnique: jest.fn().mockResolvedValue({
          codigo: 'NOBI10',
          descuentoPorcentaje: new Prisma.Decimal('10'),
          estado: AfiliadoEstado.inactivo,
        }),
      },
    };
    const service = new PlatformAffiliatesService(prisma as never);

    await expect(service.validatePublicCode('NOBI10')).resolves.toEqual({
      valid: false,
      code: 'NOBI10',
      discountPercent: '0.00',
      reason: 'inactive',
    });
  });
});
