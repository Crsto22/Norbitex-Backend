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
  VentaEntregaEstado,
  VentaEntregaTipo,
  VentaEstado,
} from '@prisma/client';
import {
  scopedCreatorId,
  type CommercialScope,
} from '../../common/commercial-access';
import { PrismaService } from '../../prisma/prisma.service';
import { CourierAgenciesService } from '../courier-agencies/courier-agencies.service';
import { EnviosConfigService } from '../envios-config/envios-config.service';
import {
  FindPublicShippingAgenciesDto,
  SubmitShippingDetailsDto,
} from './dto/submit-shipping-details.dto';
import { calcularFechasDespacho } from './shipping-dates.util';

const publicCodeAlphabet =
  '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const publicCodeLength = 12;
const publicShippingLinkInclude = {
  venta: {
    select: {
      estado: true,
      correlativo: true,
      empresaId: true,
      empresa: {
        select: {
          nombreComercial: true,
          logoUrl: true,
        },
      },
      detalles: {
        select: {
          cantidad: true,
          descripcion: true,
          productoVariante: {
            select: {
              producto: { select: { nombre: true } },
            },
          },
        },
      },
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
    private readonly enviosConfig: EnviosConfigService,
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
      select: {
        id: true,
        estado: true,
        estadoEntrega: true,
        envio: true,
        entregas: { select: { tipo: true } },
      },
    });

    if (!sale) throw new NotFoundException('Venta no encontrada');
    if (sale.estado === VentaEstado.anulada) {
      throw new ConflictException(
        'No se puede generar un enlace para una venta anulada',
      );
    }

    const metodos = await this.enviosConfig.enabledMetodosDetalle(empresaId);
    const hasDespachoMethods = metodos.some((item) => item.tipo !== 'recojo');
    const hasRecojo = metodos.some((item) => item.tipo === 'recojo');

    if (hasDespachoMethods) {
      const despacho = await this.enviosConfig.getDespacho(empresaId);
      if (!despacho.configurado) {
        throw new ConflictException(
          'Configura los días de despacho y la hora de corte antes de generar el enlace de envío',
        );
      }
    }
    if (hasRecojo) {
      const recojo = await this.enviosConfig.getRecojo(empresaId);
      if (!recojo.configurado) {
        throw new ConflictException(
          'Configura los días de recojo y la hora de corte antes de generar el enlace de envío',
        );
      }
    }

    if (sale.envio && !regenerate) return this.toInternalResponse(sale.envio);

    const hasRecordedDelivery = sale.entregas.length > 0;
    const hasCourierDispatch = sale.entregas.some(
      (delivery) => delivery.tipo === VentaEntregaTipo.COURIER,
    );
    if (
      (!sale.envio &&
        hasRecordedDelivery &&
        sale.estadoEntrega === VentaEntregaEstado.entregada) ||
      (regenerate && hasCourierDispatch)
    ) {
      throw new ConflictException(
        hasCourierDispatch
          ? 'No se puede regenerar el enlace porque ya existen despachos al courier'
          : 'No se puede generar un envio para una venta ya entregada',
      );
    }

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
      : await this.prisma.$transaction(async (tx) => {
          // Las ventas inmediatas se crean como entregadas, pero sin una
          // VentaEntrega real. Al convertirlas en envio, sus productos deben
          // volver a estar pendientes para poder despacharlos al courier.
          if (!hasRecordedDelivery) {
            await tx.ventaDetalle.updateMany({
              where: { ventaId: sale.id },
              data: { cantidadEntregada: 0 },
            });
            await tx.venta.update({
              where: { id: sale.id },
              data: { estadoEntrega: VentaEntregaEstado.pendiente },
            });
          }
          return tx.ventaEnvio.create({
            data: { ventaId: sale.id, codigoPublico },
          });
        });

    return this.toInternalResponse(envio);
  }

  async getPublic(code: string) {
    const envio = await this.findAvailablePublicLink(code);
    const metodosEnvio = await this.enviosConfig.enabledMetodosDetalle(
      envio.venta.empresaId,
    );
    const despacho = await this.getDespachoPublico(envio.venta.empresaId);
    const recojo = await this.getRecojoPublico(envio.venta.empresaId);
    return this.toPublicResponse(envio, metodosEnvio, despacho, recojo);
  }

  async submitPublic(code: string, dto: SubmitShippingDetailsDto) {
    const envio = await this.findAvailablePublicLink(code);
    if (envio.estado === VentaEnvioEstado.recibido) {
      throw new ConflictException('Los datos de envio ya fueron recibidos');
    }
    const metodo = await this.enviosConfig.getMetodo(
      envio.venta.empresaId,
      dto.metodo,
    );
    if (!metodo?.activo) {
      throw new BadRequestException('El metodo de envio no esta disponible');
    }

    const tipoDocumento = dto.tipoDocumento ?? 'DNI';
    const numeroDocumento = dto.dni.trim();
    if (tipoDocumento === 'DNI' && !/^\d{8}$/.test(numeroDocumento)) {
      throw new BadRequestException('El DNI debe tener 8 digitos');
    }
    if (tipoDocumento === 'CE' && !/^\d{9,12}$/.test(numeroDocumento)) {
      throw new BadRequestException(
        'El carnet de extranjeria debe tener entre 9 y 12 digitos',
      );
    }

    let fechaEnvio: Date;
    if (metodo.tipo === 'recojo') {
      const recojo = await this.getRecojoPublico(envio.venta.empresaId);
      if (!recojo || !recojo.fechaListo) {
        throw new BadRequestException(
          'El negocio aun no configuro los dias de recojo',
        );
      }
      fechaEnvio = new Date(`${recojo.fechaListo}T00:00:00.000Z`);
    } else {
      const despacho = await this.enviosConfig.getDespacho(
        envio.venta.empresaId,
      );
      if (!despacho.configurado) {
        throw new BadRequestException(
          'El negocio aun no configuro los dias de despacho',
        );
      }
      if (!dto.fechaEnvio) {
        throw new BadRequestException('Seleccione la fecha de envio');
      }
      const fechasDisponibles = calcularFechasDespacho(
        despacho.diasSemana,
        despacho.horaCorte,
        despacho.anticipacionDias,
      );
      if (!fechasDisponibles.includes(dto.fechaEnvio)) {
        throw new BadRequestException('La fecha de envio no esta disponible');
      }
      fechaEnvio = new Date(`${dto.fechaEnvio}T00:00:00.000Z`);
    }

    const datos = {
      nombreCompleto: dto.nombreCompleto.trim().replace(/\s+/g, ' '),
      dni: numeroDocumento,
      tipoDocumento,
      celular: dto.celular,
      metodoEnvio: metodo.metodo,
      fechaEnvio,
      recibidoAt: new Date(),
    };

    if (metodo.tipo === 'recojo') {
      return this.submitPickup(envio, {
        ...datos,
        direccion: metodo.direccion ?? null,
      });
    }

    if (metodo.tipo === 'domicilio') {
      return this.submitDelivery(envio, datos, dto);
    }

    if (!dto.agencia || !dto.agenciaExternalId) {
      throw new BadRequestException('Seleccione una agencia de envio');
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
        ...datos,
        estado: VentaEnvioEstado.recibido,
        estadoLogistico: VentaEnvioEstadoLogistico.POR_DESPACHAR,
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

  private async submitDelivery(
    envio: PublicShippingLink,
    datos: {
      nombreCompleto: string;
      dni: string;
      celular: string;
      metodoEnvio: string;
      fechaEnvio: Date;
      recibidoAt: Date;
    },
    dto: SubmitShippingDetailsDto,
  ) {
    const direccionEntrega = dto.direccionEntrega?.trim();
    if (!direccionEntrega) {
      throw new BadRequestException('Ingrese la direccion de entrega');
    }

    const result = await this.prisma.ventaEnvio.updateMany({
      where: {
        id: envio.id,
        estado: VentaEnvioEstado.pendiente,
      },
      data: {
        ...datos,
        estado: VentaEnvioEstado.recibido,
        estadoLogistico: VentaEnvioEstadoLogistico.POR_DESPACHAR,
        direccionEntrega,
        referenciaEntrega: dto.referenciaEntrega?.trim() || null,
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
        detalle: 'Datos y direccion de entrega recibidos',
      },
    });

    return { estado: VentaEnvioEstado.recibido };
  }

  private async submitPickup(
    envio: PublicShippingLink,
    datos: {
      nombreCompleto: string;
      dni: string;
      celular: string;
      metodoEnvio: string;
      fechaEnvio: Date;
      recibidoAt: Date;
      direccion: string | null;
    },
  ) {
    const { direccion, ...envioData } = datos;
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.ventaEnvio.updateMany({
        where: {
          id: envio.id,
          estado: VentaEnvioEstado.pendiente,
        },
        data: {
          ...envioData,
          estado: VentaEnvioEstado.recibido,
          estadoLogistico: VentaEnvioEstadoLogistico.POR_PREPARAR,
          agencia: null,
          agenciaExternalId: null,
          agenciaNombre: 'Recojo en tienda',
          agenciaDireccion: direccion,
          agenciaDepartamento: null,
          agenciaProvincia: null,
          agenciaDistrito: null,
          agenciaUbigeo: null,
          agenciaLatitud: null,
          agenciaLongitud: null,
        },
      });

      if (updated.count !== 1) return updated;

      await tx.venta.update({
        where: { id: envio.ventaId },
        data: {
          recojoPosterior: true,
          estadoEntrega: VentaEntregaEstado.pendiente,
        },
      });

      await tx.ventaEnvioHistorial.create({
        data: {
          ventaEnvioId: envio.id,
          estadoAnterior: envio.estadoLogistico,
          estadoNuevo: VentaEnvioEstadoLogistico.POR_PREPARAR,
          detalle: 'Recojo en tienda registrado por el cliente',
        },
      });

      return updated;
    });

    if (result.count !== 1) {
      throw new ConflictException('Los datos de envio ya fueron recibidos');
    }

    return { estado: VentaEnvioEstado.recibido };
  }

  async findPublicAgencies(code: string, dto: FindPublicShippingAgenciesDto) {
    const envio = await this.findAvailablePublicLink(code);
    if (envio.estado === VentaEnvioEstado.recibido) {
      throw new ConflictException('Los datos de envio ya fueron recibidos');
    }
    const enabled = await this.enviosConfig.isEnabled(
      envio.venta.empresaId,
      dto.agencia,
    );
    if (!enabled) {
      throw new BadRequestException('El metodo de envio no esta disponible');
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
    tipoDocumento: string;
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
    metodoEnvio: string | null;
    direccionEntrega: string | null;
    referenciaEntrega: string | null;
    fechaEnvio: Date | null;
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
      tipoDocumento: envio.tipoDocumento,
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
      metodoEnvio: envio.metodoEnvio,
      direccionEntrega: envio.direccionEntrega,
      referenciaEntrega: envio.referenciaEntrega,
      fechaEnvio: envio.fechaEnvio?.toISOString().slice(0, 10) ?? null,
      recibidoAt: envio.recibidoAt?.toISOString() ?? null,
      despachadoAt: envio.despachadoAt?.toISOString() ?? null,
      entregadoAt: envio.entregadoAt?.toISOString() ?? null,
      incidencias: [],
      historial: [],
    };
  }

  private toPublicResponse(
    envio: PublicShippingLink,
    metodosEnvio: Array<{
      metodo: string;
      nombre: string;
      tipo: string;
      direccion: string | null;
    }>,
    despacho: {
      diasSemana: number[];
      horaCorte: string;
      fechasDisponibles: string[];
    } | null,
    recojo: {
      diasSemana: number[];
      horaCorte: string;
      anticipacionDias: number;
      usaDespacho: boolean;
      fechasDisponibles: string[];
      fechaListo: string | null;
    } | null,
  ) {
    const productos = new Map<string, number>();
    for (const detalle of envio.venta.detalles) {
      const nombre =
        detalle.descripcion?.trim() ||
        detalle.productoVariante.producto.nombre;
      productos.set(nombre, (productos.get(nombre) ?? 0) + detalle.cantidad);
    }

    return {
      estado: envio.estado,
      venta: { correlativo: envio.venta.correlativo },
      negocio: envio.venta.empresa,
      productos: Array.from(productos, ([nombre, cantidad]) => ({
        nombre,
        cantidad,
      })),
      metodosEnvio,
      despacho,
      recojo,
    };
  }

  private async getDespachoPublico(empresaId: bigint) {
    const config = await this.enviosConfig.getDespacho(empresaId);
    if (!config.configurado) return null;

    return {
      diasSemana: config.diasSemana,
      horaCorte: config.horaCorte,
      anticipacionDias: config.anticipacionDias,
      fechasDisponibles: calcularFechasDespacho(
        config.diasSemana,
        config.horaCorte,
        config.anticipacionDias,
      ),
    };
  }

  private async getRecojoPublico(empresaId: bigint) {
    const config = await this.enviosConfig.getRecojo(empresaId);
    if (!config.configurado) return null;

    const fechasDisponibles = calcularFechasDespacho(
      config.diasSemana,
      config.horaCorte,
      config.anticipacionDias,
    );

    return {
      diasSemana: config.diasSemana,
      horaCorte: config.horaCorte,
      anticipacionDias: config.anticipacionDias,
      usaDespacho: config.usaDespacho,
      fechasDisponibles,
      fechaListo: fechasDisponibles[0] ?? null,
    };
  }

  private toCourierProvider(agency: VentaEnvioAgencia) {
    return agency === VentaEnvioAgencia.SHALOM
      ? AgenciaCourierProveedor.SHALOM
      : AgenciaCourierProveedor.OLVA;
  }
}
