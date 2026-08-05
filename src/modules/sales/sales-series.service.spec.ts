import { BadRequestException } from '@nestjs/common';
import { VentaTipoComprobante } from '@prisma/client';
import { SalesService } from './sales.service';

describe('SalesService series', () => {
  const service = new SalesService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  it('rejects invalid SUNAT series before storing them', async () => {
    await expect(
      service.createSerie(1n, {
        tipoComprobante: VentaTipoComprobante.guia_remision,
        serie: 'TAB1',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.createSerie(1n, {
        tipoComprobante: VentaTipoComprobante.nota_credito_factura,
        serie: 'BC01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
