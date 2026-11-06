import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { Prisma, VentaEnvioEstado, VentaEstado } from '@prisma/client';
import {
  scopedCreatorId,
  type CommercialScope,
} from '../../common/commercial-access';
import { PrismaService } from '../../prisma/prisma.service';
import { SubmitShippingDetailsDto } from './dto/submit-shipping-details.dto';

const publicCodeAlphabet =
  '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const publicCodeLength = 12;
const publicShippingLinkInclude = {
  venta: {
    select: {
      estado: true,
      correlativo: true,
      empresa: { select: { nombreComercial: true, logoUrl: true } },
    },
  },
} satisfies Prisma.VentaEnvioInclude;

type PublicShippingLink = Prisma.VentaEnvioGetPayload<{
  include: typeof publicShippingLinkInclude;
}>;

@Injectable()
export class ShippingLinksService {
  constructor(private readonly prisma: PrismaService) {}

  async generate(
    empresaId: bigint,
    scope: CommercialScope,
    publicId: string,
    regenerate = false,
  ) {
    const sale = await this.prisma.venta.findFirst({
      where: {
        publicId,
        empresaId,
        ...(scope.branchId ? { sucursalId: scope.branchId } : {}),
        ...(scopedCreatorId(scope)
          ? { creadoPorId: scopedCreatorId(scope)! }
          : {}),
      },
      select: { id: true, estado: true, envio: true },
    });

    if (!sale) throw new NotFoundException('Venta no encontrada');
    if (sale.estado === VentaEstado.anulada) {
      throw new ConflictException(
        'No se puede generar un enlace para una venta anulada',
      );
    }

    if (sale.envio && !regenerate) return this.toInternalResponse(sale.envio);

    const codigoPublico = await this.uniquePublicCode();
    const envio = sale.envio
      ? await this.prisma.ventaEnvio.update({
          where: { ventaId: sale.id },
          data: {
            codigoPublico,
            estado: VentaEnvioEstado.pendiente,
            nombreCompleto: null,
            dni: null,
            celular: null,
            agencia: null,
            recibidoAt: null,
          },
        })
      : await this.prisma.ventaEnvio.create({
          data: { ventaId: sale.id, codigoPublico },
        });

    return this.toInternalResponse(envio);
  }

  async getPublic(code: string) {
    const envio = await this.findAvailablePublicLink(code);
    return this.toPublicResponse(envio);
  }

  async submitPublic(code: string, dto: SubmitShippingDetailsDto) {
    const envio = await this.findAvailablePublicLink(code);
    if (envio.estado === VentaEnvioEstado.recibido) {
      throw new ConflictException('Los datos de envio ya fueron recibidos');
    }

    const result = await this.prisma.ventaEnvio.updateMany({
      where: {
        id: envio.id,
        estado: VentaEnvioEstado.pendiente,
      },
      data: {
        estado: VentaEnvioEstado.recibido,
        nombreCompleto: dto.nombreCompleto.trim().replace(/\s+/g, ' '),
        dni: dto.dni,
        celular: dto.celular,
        agencia: dto.agencia,
        recibidoAt: new Date(),
      },
    });

    if (result.count !== 1) {
      throw new ConflictException('Los datos de envio ya fueron recibidos');
    }

    return { estado: VentaEnvioEstado.recibido };
  }

  private async findAvailablePublicLink(code: string) {
    if (
      !new RegExp(`^[${publicCodeAlphabet}]{${publicCodeLength}}$`).test(code)
    ) {
      throw new NotFoundException('Enlace no disponible');
    }

    const envio = await this.prisma.ventaEnvio.findUnique({
      where: { codigoPublico: code },
      include: publicShippingLinkInclude,
    });

    if (!envio || envio.venta.estado === VentaEstado.anulada) {
      throw new NotFoundException('Enlace no disponible');
    }
    return envio;
  }

  private async uniquePublicCode() {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = Array.from(
        { length: publicCodeLength },
        () => publicCodeAlphabet[randomInt(publicCodeAlphabet.length)],
      ).join('');
      const exists = await this.prisma.ventaEnvio.findUnique({
        where: { codigoPublico: code },
        select: { id: true },
      });
      if (!exists) return code;
    }
    throw new ConflictException('No se pudo generar el enlace de envio');
  }

  private toInternalResponse(envio: {
    codigoPublico: string;
    estado: VentaEnvioEstado;
    nombreCompleto: string | null;
    dni: string | null;
    celular: string | null;
    agencia: 'SHALOM' | 'OLVA' | null;
    recibidoAt: Date | null;
  }) {
    return {
      codigo: envio.codigoPublico,
      estado: envio.estado,
      nombreCompleto: envio.nombreCompleto,
      dni: envio.dni,
      celular: envio.celular,
      agencia: envio.agencia,
      recibidoAt: envio.recibidoAt?.toISOString() ?? null,
    };
  }

  private toPublicResponse(envio: PublicShippingLink) {
    return {
      estado: envio.estado,
      venta: { correlativo: envio.venta.correlativo },
      negocio: envio.venta.empresa,
    };
  }
}
