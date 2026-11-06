import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomInt } from 'node:crypto';
import {
  AgenciaCourierProveedor,
  Prisma,
  VentaEnvioAgencia,
  VentaEnvioEstado,
  VentaEnvioEstadoLogistico,
  VentaEstado,
} from '@prisma/client';
import {
  scopedCreatorId,
  type CommercialScope,
} from '../../common/commercial-access';
import { PrismaService } from '../../prisma/prisma.service';
import { CourierAgenciesService } from '../courier-agencies/courier-agencies.service';
import {
  FindPublicShippingAgenciesDto,
  SubmitShippingDetailsDto,
} from './dto/submit-shipping-details.dto';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly courierAgencies: CourierAgenciesService,
  ) {}

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
            estadoLogistico: VentaEnvioEstadoLogistico.POR_PREPARAR,
            nombreCompleto: null,
            dni: null,
            celular: null,
            agencia: null,
            agenciaExternalId: null,
            agenciaNombre: null,
            agenciaDireccion: null,
            agenciaDepartamento: null,
            agenciaProvincia: null,
            agenciaDistrito: null,
            agenciaUbigeo: null,
            agenciaLatitud: null,
            agenciaLongitud: null,
            recibidoAt: null,
            despachadoAt: null,
            entregadoAt: null,
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
    const courier = this.toCourierProvider(dto.agencia);
    const agency = await this.prisma.agenciaCourier.findUnique({
      where: {
        courier_externalId: {
          courier,
          externalId: dto.agenciaExternalId.trim(),
        },
      },
    });
    if (!agency || !agency.activo) {
      throw new NotFoundException('La agencia seleccionada no esta disponible');
    }

    const result = await this.prisma.ventaEnvio.updateMany({
      where: {
        id: envio.id,
        estado: VentaEnvioEstado.pendiente,
      },
      data: {
        estado: VentaEnvioEstado.recibido,
        estadoLogistico: VentaEnvioEstadoLogistico.POR_DESPACHAR,
        nombreCompleto: dto.nombreCompleto.trim().replace(/\s+/g, ' '),
        dni: dto.dni,
        celular: dto.celular,
        agencia: dto.agencia,
        agenciaExternalId: agency.externalId,
        agenciaNombre: agency.nombre,
        agenciaDireccion: agency.direccion,
        agenciaDepartamento: agency.departamento,
        agenciaProvincia: agency.provincia,
        agenciaDistrito: agency.distrito,
        agenciaUbigeo: agency.ubigeo,
        agenciaLatitud: agency.latitud,
        agenciaLongitud: agency.longitud,
        recibidoAt: new Date(),
      },
    });

    if (result.count !== 1) {
      throw new ConflictException('Los datos de envio ya fueron recibidos');
    }

    await this.prisma.ventaEnvioHistorial.create({
      data: {
        ventaEnvioId: envio.id,
        estadoAnterior: envio.estadoLogistico,
        estadoNuevo: VentaEnvioEstadoLogistico.POR_DESPACHAR,
        detalle: 'Datos de envio y agencia recibidos',
      },
    });

    return { estado: VentaEnvioEstado.recibido };
  }

  async findPublicAgencies(code: string, dto: FindPublicShippingAgenciesDto) {
    const envio = await this.findAvailablePublicLink(code);
    if (envio.estado === VentaEnvioEstado.recibido) {
      throw new ConflictException('Los datos de envio ya fueron recibidos');
    }
    const courier = this.toCourierProvider(dto.agencia);
    if ((dto.lat === undefined) !== (dto.lng === undefined)) {
      throw new BadRequestException(
        'La latitud y longitud deben enviarse juntas',
      );
    }
    if (dto.q?.trim()) {
      return this.courierAgencies.search(
        courier,
        dto.q.trim(),
        50,
        dto.lat !== undefined && dto.lng !== undefined
          ? { latitude: dto.lat, longitude: dto.lng }
          : undefined,
      );
    }
    return this.courierAgencies.browseForShipping(courier, {
      latitude: dto.lat,
      longitude: dto.lng,
    });
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
    estadoLogistico: VentaEnvioEstadoLogistico;
    nombreCompleto: string | null;
    dni: string | null;
    celular: string | null;
    agencia: 'SHALOM' | 'OLVA' | null;
    agenciaExternalId: string | null;
    agenciaNombre: string | null;
    agenciaDireccion: string | null;
    agenciaDepartamento: string | null;
    agenciaProvincia: string | null;
    agenciaDistrito: string | null;
    agenciaUbigeo: string | null;
    agenciaLatitud: number | null;
    agenciaLongitud: number | null;
    recibidoAt: Date | null;
    despachadoAt: Date | null;
    entregadoAt: Date | null;
  }) {
    return {
      codigo: envio.codigoPublico,
      estado: envio.estado,
      estadoLogistico: envio.estadoLogistico,
      nombreCompleto: envio.nombreCompleto,
      dni: envio.dni,
      celular: envio.celular,
      agencia: envio.agencia,
      agenciaExternalId: envio.agenciaExternalId,
      agenciaNombre: envio.agenciaNombre,
      agenciaDireccion: envio.agenciaDireccion,
      agenciaDepartamento: envio.agenciaDepartamento,
      agenciaProvincia: envio.agenciaProvincia,
      agenciaDistrito: envio.agenciaDistrito,
      agenciaUbigeo: envio.agenciaUbigeo,
      agenciaLatitud: envio.agenciaLatitud,
      agenciaLongitud: envio.agenciaLongitud,
      recibidoAt: envio.recibidoAt?.toISOString() ?? null,
      despachadoAt: envio.despachadoAt?.toISOString() ?? null,
      entregadoAt: envio.entregadoAt?.toISOString() ?? null,
      incidencias: [],
      historial: [],
    };
  }

  private toPublicResponse(envio: PublicShippingLink) {
    return {
      estado: envio.estado,
      venta: { correlativo: envio.venta.correlativo },
      negocio: envio.venta.empresa,
    };
  }

  private toCourierProvider(agency: VentaEnvioAgencia) {
    return agency === VentaEnvioAgencia.SHALOM
      ? AgenciaCourierProveedor.SHALOM
      : AgenciaCourierProveedor.OLVA;
  }
}
