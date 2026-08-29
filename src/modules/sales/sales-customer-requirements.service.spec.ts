import { BadRequestException } from '@nestjs/common';
import {
  ClienteTipoDocumento,
  Prisma,
  VentaTipoComprobante,
} from '@prisma/client';
import { SalesService } from './sales.service';

describe('SalesService customer requirements', () => {
  const service = new SalesService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  ) as unknown as {
    validateSaleCustomerRequirements: (
      tipoComprobante: VentaTipoComprobante,
      cliente: {
        tipoDocumento: ClienteTipoDocumento;
        numeroDocumento: string | null;
        razonSocial?: string | null;
      } | null,
      total: Prisma.Decimal,
    ) => void;
  };

  it('requires RUC for invoices', () => {
    expect(() =>
      service.validateSaleCustomerRequirements(
        VentaTipoComprobante.factura,
        null,
        new Prisma.Decimal(100),
      ),
    ).toThrow(BadRequestException);
  });

  it('allows receipt at S/700 without DNI', () => {
    expect(() =>
      service.validateSaleCustomerRequirements(
        VentaTipoComprobante.boleta,
        null,
        new Prisma.Decimal(700),
      ),
    ).not.toThrow();
  });

  it('requires DNI for receipt above S/700', () => {
    expect(() =>
      service.validateSaleCustomerRequirements(
        VentaTipoComprobante.boleta,
        null,
        new Prisma.Decimal('700.01'),
      ),
    ).toThrow(BadRequestException);
  });
});
