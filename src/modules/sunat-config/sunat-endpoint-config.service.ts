import { Injectable } from '@nestjs/common';
import { SunatAmbiente, SunatEndpointCodigo } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SunatEndpointConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveEndpointUrl(
    ambiente: SunatAmbiente,
    codigo: SunatEndpointCodigo,
  ) {
    const endpoint = await this.prisma.sunatEndpointConfig.findUnique({
      where: {
        ambiente_codigo: {
          ambiente,
          codigo,
        },
      },
      select: {
        url: true,
        activo: true,
      },
    });

    if (!endpoint?.activo) {
      return null;
    }

    return endpoint.url;
  }
}
