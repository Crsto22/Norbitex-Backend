import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GuiaRemisionEstado,
  GuiaRemisionParticipanteTipo,
  Prisma,
  SunatEstado,
  VentaEstado,
  VentaTipoComprobante,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  scopedCreatorId,
  type CommercialScope,
} from '../../common/commercial-access';
import { SunatDocumentStorageService } from '../sunat-emission/sunat-document-storage.service';
import { SunatJobService } from '../sunat-emission/sunat-job.service';
import {
  AnnulGuiaRemisionDto,
  AutocompletarGuiaVentaQueryDto,
  CreateGuiaRemisionDto,
  FindGuiasRemisionQueryDto,
  GuiaRemisionDetalleDto,
  GuiaRemisionParticipanteDto,
  GuiaRemisionVehiculoDto,
  UpdateGuiaRemisionDto,
} from './dto/guia-remision.dto';

const guiaInclude = {
  empresa: true,
  sucursal: { select: { id: true, nombre: true } },
  sucursalPartida: { select: { id: true, nombre: true } },
  sucursalLlegada: { select: { id: true, nombre: true } },
  creadoPor: { select: { id: true, nombre: true, apellido: true } },
  serieComprobante: {
    select: { id: true, serie: true, tipoComprobante: true },
  },
  detalles: {
    include: {
      productoVariante: {
        include: {
          producto: { select: { id: true, nombre: true, publicId: true } },
        },
      },
    },
    orderBy: { id: 'asc' },
  },
  documentosRelacionados: { orderBy: { id: 'asc' } },
  participantes: { orderBy: { id: 'asc' } },
  vehiculos: { orderBy: { id: 'asc' } },
} satisfies Prisma.GuiaRemisionInclude;

type GuiaWithRelations = Prisma.GuiaRemisionGetPayload<{
  include: typeof guiaInclude;
}>;

@Injectable()
export class GuiaRemisionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly sunatJobService: SunatJobService,
    private readonly documentStorageService: SunatDocumentStorageService,
  ) {}

  async create(empresaId: bigint, userId: string, dto: CreateGuiaRemisionDto) {
    await this.validateCompany(empresaId);
    const sucursal = await this.resolveSucursal(empresaId, dto.sucursalId);
    const partida = await this.resolvePunto(
      empresaId,
      dto.sucursalPartidaId,
      dto.ubigeoPartida,
      dto.direccionPartida,
      'partida',
    );
    const llegada = await this.resolvePunto(
      empresaId,
      dto.sucursalLlegadaId,
      dto.ubigeoLlegada,
      dto.direccionLlegada,
      'llegada',
    );
    const serie = await this.resolveSerie(empresaId, sucursal.id, dto.serie);
    const payload = await this.preparePayload(empresaId, dto);
    this.validateBeforeSave({
      dto,
      detalles: payload.detalles,
      participantes: payload.participantes,
      vehiculos: payload.vehiculos,
    });

    const guia = await this.prisma.$transaction(async (tx) => {
      const updatedSerie = await tx.serieComprobante.update({
        where: { id: serie.id },
        data: { numeroActual: { increment: 1 } },
      });
      const numero = updatedSerie.numeroActual;
      const correlativo = `${serie.serie}-${numero.toString().padStart(8, '0')}`;

      return tx.guiaRemision.create({
        data: {
          empresaId,
          sucursalId: sucursal.id,
          creadoPorId: BigInt(userId),
          serieComprobanteId: serie.id,
          serie: serie.serie,
          numero,
          correlativo,
          fechaInicioTraslado: this.parseDate(
            dto.fechaInicioTraslado,
            'fechaInicioTraslado',
          ),
          fechaEntregaTransportista: dto.fechaEntregaTransportista
            ? this.parseDate(
                dto.fechaEntregaTransportista,
                'fechaEntregaTransportista',
              )
            : null,
          motivoTraslado: dto.motivoTraslado ?? '04',
          descripcionMotivo: this.optional(dto.descripcionMotivo),
          modalidadTransporte: dto.modalidadTransporte,
          pesoBrutoTotal: this.parsePositiveDecimal(
            dto.pesoBrutoTotal,
            'pesoBrutoTotal',
          ),
          unidadPeso: (dto.unidadPeso ?? 'KGM').toUpperCase(),
          numeroBultos: dto.numeroBultos ?? null,
          observaciones: this.optional(dto.observaciones),
          sucursalPartidaId: partida.sucursalId,
          ubigeoPartida: partida.ubigeo,
          direccionPartida: partida.direccion,
          sucursalLlegadaId: llegada.sucursalId,
          ubigeoLlegada: llegada.ubigeo,
          direccionLlegada: llegada.direccion,
          destinatarioTipoDoc: this.clean(dto.destinatarioTipoDoc),
          destinatarioNroDoc: this.clean(dto.destinatarioNroDoc),
          destinatarioRazonSocial: this.clean(dto.destinatarioRazonSocial),
          sunatEstado: SunatEstado.no_aplica,
          detalles: { create: payload.detalles },
          documentosRelacionados: { create: payload.documentosRelacionados },
          participantes: { create: payload.participantes },
          vehiculos: { create: payload.vehiculos },
        },
        include: guiaInclude,
      });
    });

    if (dto.emitirDirectamente) {
      return this.emitir(empresaId, guia.publicId);
    }

    return this.toResponse(guia);
  }

  async findAll(
    empresaId: bigint,
    scope: CommercialScope,
    query: FindGuiasRemisionQueryDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? this.getDefaultPaginationLimit();
    const sucursalId = this.parseOptionalId(query.sucursalId, 'sucursalId');
    const search = query.q?.trim();
    const where: Prisma.GuiaRemisionWhereInput = {
      empresaId,
      ...(sucursalId ? { sucursalId } : {}),
      ...(scopedCreatorId(scope)
        ? { creadoPorId: scopedCreatorId(scope)! }
        : {}),
      ...(query.estado ? { estado: query.estado } : {}),
      ...(query.sunatEstado ? { sunatEstado: query.sunatEstado } : {}),
      ...(search
        ? {
            OR: [
              { correlativo: { contains: search, mode: 'insensitive' } },
              {
                destinatarioNroDoc: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                destinatarioRazonSocial: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
            ],
          }
        : {}),
    };

    const [guias, total] = await this.prisma.$transaction([
      this.prisma.guiaRemision.findMany({
        where,
        include: guiaInclude,
        orderBy: [{ createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.guiaRemision.count({ where }),
    ]);

    return {
      data: guias.map((guia) => this.toResponse(guia)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async findOne(empresaId: bigint, publicId: string) {
    return this.toResponse(await this.findEntity(empresaId, publicId));
  }

  async update(
    empresaId: bigint,
    publicId: string,
    dto: UpdateGuiaRemisionDto,
  ) {
    const current = await this.findEntity(empresaId, publicId);
    if (current.estado !== GuiaRemisionEstado.borrador) {
      throw new BadRequestException(
        'Solo se puede editar una guia en borrador',
      );
    }

    const partida = await this.resolvePunto(
      empresaId,
      dto.sucursalPartidaId,
      dto.ubigeoPartida,
      dto.direccionPartida,
      'partida',
    );
    const llegada = await this.resolvePunto(
      empresaId,
      dto.sucursalLlegadaId,
      dto.ubigeoLlegada,
      dto.direccionLlegada,
      'llegada',
    );
    const payload = await this.preparePayload(empresaId, dto);
    this.validateBeforeSave({
      dto,
      detalles: payload.detalles,
      participantes: payload.participantes,
      vehiculos: payload.vehiculos,
    });

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.guiaRemisionDetalle.deleteMany({
        where: { guiaRemisionId: current.id },
      });
      await tx.guiaRemisionDocumentoRelacionado.deleteMany({
        where: { guiaRemisionId: current.id },
      });
      await tx.guiaRemisionTransporteParticipante.deleteMany({
        where: { guiaRemisionId: current.id },
      });
      await tx.guiaRemisionVehiculo.deleteMany({
        where: { guiaRemisionId: current.id },
      });

      return tx.guiaRemision.update({
        where: { id: current.id },
        data: {
          fechaInicioTraslado: this.parseDate(
            dto.fechaInicioTraslado,
            'fechaInicioTraslado',
          ),
          fechaEntregaTransportista: dto.fechaEntregaTransportista
            ? this.parseDate(
                dto.fechaEntregaTransportista,
                'fechaEntregaTransportista',
              )
            : null,
          motivoTraslado: dto.motivoTraslado ?? '04',
          descripcionMotivo: this.optional(dto.descripcionMotivo),
          modalidadTransporte: dto.modalidadTransporte,
          pesoBrutoTotal: this.parsePositiveDecimal(
            dto.pesoBrutoTotal,
            'pesoBrutoTotal',
          ),
          unidadPeso: (dto.unidadPeso ?? 'KGM').toUpperCase(),
          numeroBultos: dto.numeroBultos ?? null,
          observaciones: this.optional(dto.observaciones),
          sucursalPartidaId: partida.sucursalId,
          ubigeoPartida: partida.ubigeo,
          direccionPartida: partida.direccion,
          sucursalLlegadaId: llegada.sucursalId,
          ubigeoLlegada: llegada.ubigeo,
          direccionLlegada: llegada.direccion,
          destinatarioTipoDoc: this.clean(dto.destinatarioTipoDoc),
          destinatarioNroDoc: this.clean(dto.destinatarioNroDoc),
          destinatarioRazonSocial: this.clean(dto.destinatarioRazonSocial),
          detalles: { create: payload.detalles },
          documentosRelacionados: { create: payload.documentosRelacionados },
          participantes: { create: payload.participantes },
          vehiculos: { create: payload.vehiculos },
        },
        include: guiaInclude,
      });
    });

    if (dto.emitirDirectamente) {
      return this.emitir(empresaId, updated.publicId);
    }

    return this.toResponse(updated);
  }

  async emitir(empresaId: bigint, publicId: string) {
    const guia = await this.findEntity(empresaId, publicId);
    if (guia.estado === GuiaRemisionEstado.anulada) {
      throw new BadRequestException('No se puede emitir una guia anulada');
    }
    if (guia.sunatEstado === SunatEstado.aceptado) {
      throw new BadRequestException('La guia ya fue aceptada por SUNAT');
    }

    this.validateBeforeEmit(guia);

    await this.prisma.$transaction([
      this.prisma.guiaRemision.update({
        where: { id: guia.id },
        data: {
          estado: GuiaRemisionEstado.emitida,
          sunatEstado: SunatEstado.pendiente_envio,
          sunatCodigo: null,
          sunatMensaje: 'Guia programada para envio a SUNAT.',
          sunatHash: null,
          sunatTicket: null,
          sunatXmlNombre: null,
          sunatXmlKey: null,
          sunatZipNombre: null,
          sunatZipKey: null,
          sunatCdrNombre: null,
          sunatCdrKey: null,
          sunatEnviadoAt: null,
          sunatRespondidoAt: null,
        },
      }),
    ]);
    await this.sunatJobService.enqueueGuiaRemision(empresaId, guia.id);

    return this.findOne(empresaId, publicId);
  }

  async consultarCdr(empresaId: bigint, publicId: string) {
    const guia = await this.findEntity(empresaId, publicId);
    if (!guia.sunatTicket) {
      throw new BadRequestException(
        'La guia no tiene ticket SUNAT para consultar',
      );
    }
    await this.sunatJobService.enqueueGuiaRemision(empresaId, guia.id);
    return this.findOne(empresaId, publicId);
  }

  async annul(empresaId: bigint, publicId: string, dto: AnnulGuiaRemisionDto) {
    const guia = await this.findEntity(empresaId, publicId);
    if (guia.sunatEstado === SunatEstado.aceptado) {
      throw new BadRequestException(
        'La anulacion SUNAT de guias aceptadas no esta disponible en esta version',
      );
    }

    const updated = await this.prisma.guiaRemision.update({
      where: { id: guia.id },
      data: {
        estado: GuiaRemisionEstado.anulada,
        anuladoAt: new Date(),
        anuladoRazon: this.clean(dto.razon),
      },
      include: guiaInclude,
    });
    return this.toResponse(updated);
  }

  async autocompletarDesdeVenta(
    empresaId: bigint,
    scope: CommercialScope,
    query: AutocompletarGuiaVentaQueryDto,
  ) {
    const tipo = this.mapVentaTipoDocumento(query.tipoDocumento);
    const numero = Number(query.numero);
    if (!Number.isInteger(numero) || numero <= 0) {
      throw new BadRequestException('numero debe ser valido');
    }

    const ventas = await this.prisma.venta.findMany({
      where: {
        empresaId,
        ...(scope.branchId ? { sucursalId: scope.branchId } : {}),
        ...(scopedCreatorId(scope)
          ? { creadoPorId: scopedCreatorId(scope)! }
          : {}),
        estado: VentaEstado.completada,
        tipoComprobante: tipo ? tipo : { in: ['factura', 'boleta'] },
        serie: query.serie.toUpperCase(),
        numero,
      },
      include: {
        cliente: true,
        sucursal: true,
        detalles: {
          include: {
            productoVariante: { include: { producto: true } },
          },
        },
      },
    });

    if (ventas.length === 0) {
      throw new NotFoundException('Venta no encontrada');
    }
    if (ventas.length > 1) {
      throw new BadRequestException(
        'Existe mas de una venta; envie tipoDocumento 01 o 03',
      );
    }

    const venta = ventas[0];
    if (
      (venta.tipoComprobante === VentaTipoComprobante.factura ||
        venta.tipoComprobante === VentaTipoComprobante.boleta) &&
      !(
        [SunatEstado.aceptado, SunatEstado.observado] as SunatEstado[]
      ).includes(venta.sunatEstado)
    ) {
      throw new BadRequestException(
        'La venta electronica debe estar aceptada u observada por SUNAT',
      );
    }

    return {
      ventaPublicId: venta.publicId,
      documentoRelacionado: {
        tipoDocumento:
          venta.tipoComprobante === VentaTipoComprobante.factura ? '01' : '03',
        serie: venta.serie,
        numero: venta.numero.toString(),
      },
      destinatario: {
        tipoDocumento:
          venta.cliente?.tipoDocumento === 'ruc'
            ? '6'
            : venta.cliente?.tipoDocumento === 'dni'
              ? '1'
              : '0',
        numeroDocumento: venta.cliente?.numeroDocumento ?? '',
        razonSocial:
          venta.cliente?.razonSocial ?? venta.cliente?.nombre ?? 'CLIENTE',
      },
      partida: venta.sucursal
        ? {
            sucursalId: venta.sucursal.id.toString(),
            ubigeo: venta.sucursal.ubigeo,
            direccion: venta.sucursal.direccion,
          }
        : null,
      detalles: venta.detalles.map((detalle) => ({
        productoVarianteId: detalle.productoVarianteId.toString(),
        descripcion:
          detalle.descripcion ??
          detalle.productoVariante.producto.nombre ??
          'Producto',
        cantidad: detalle.cantidad.toString(),
        unidadMedida: detalle.unidadMedidaCodigo || 'NIU',
        codigoProducto:
          detalle.productoVariante.producto.publicId ??
          detalle.productoVarianteId.toString(),
      })),
    };
  }

  async downloadSunatArtifact(
    empresaId: bigint,
    publicId: string,
    artifact: 'xml' | 'cdr',
  ) {
    const guia = await this.prisma.guiaRemision.findFirst({
      where: { empresaId, publicId },
      select: {
        sunatXmlNombre: true,
        sunatXmlKey: true,
        sunatCdrNombre: true,
        sunatCdrKey: true,
      },
    });
    if (!guia) {
      throw new NotFoundException('Guia de remision no encontrada');
    }

    const key = artifact === 'xml' ? guia.sunatXmlKey : guia.sunatCdrKey;
    const fileName =
      artifact === 'xml' ? guia.sunatXmlNombre : guia.sunatCdrNombre;
    if (!key || !fileName) {
      throw new NotFoundException('Archivo SUNAT no disponible');
    }

    return {
      fileName,
      url: await this.documentStorageService.signedDownloadUrl(key, fileName),
    };
  }

  private async preparePayload(empresaId: bigint, dto: CreateGuiaRemisionDto) {
    const detalles = await this.resolveDetalles(empresaId, dto.detalles ?? []);
    const catalogoParticipantes = await this.resolveCatalogoParticipantes(
      empresaId,
      dto.catalogoParticipanteIds,
    );
    const participantes = [
      ...catalogoParticipantes,
      ...(dto.participantes ?? []).map((item) =>
        this.toParticipanteCreateData(item),
      ),
    ];
    const catalogoVehiculos = await this.resolveCatalogoVehiculos(
      empresaId,
      dto.catalogoVehiculoIds,
    );
    const vehiculos = [
      ...catalogoVehiculos,
      ...(dto.vehiculos ?? []).map((item) => this.toVehiculoCreateData(item)),
    ];

    return {
      detalles,
      documentosRelacionados: (dto.documentosRelacionados ?? []).map((doc) => ({
        tipoDocumento: doc.tipoDocumento,
        serie: this.clean(doc.serie).toUpperCase(),
        numero: this.clean(doc.numero),
      })),
      participantes,
      vehiculos,
    };
  }

  private async resolveDetalles(
    empresaId: bigint,
    detalles: GuiaRemisionDetalleDto[],
  ) {
    if (!detalles.length) {
      throw new BadRequestException('La guia requiere al menos un detalle');
    }

    const variantIds = detalles
      .map((detalle) =>
        this.parseOptionalId(detalle.productoVarianteId, 'productoVarianteId'),
      )
      .filter((id): id is bigint => Boolean(id));
    const variants = variantIds.length
      ? await this.prisma.productoVariante.findMany({
          where: {
            id: { in: variantIds },
            empresaId,
            activo: true,
            deletedAt: null,
          },
          include: { producto: true },
        })
      : [];
    const variantMap = new Map(
      variants.map((item) => [item.id.toString(), item]),
    );
    if (
      variants.length !== new Set(variantIds.map((id) => id.toString())).size
    ) {
      throw new NotFoundException('Una o mas variantes no encontradas');
    }

    return detalles.map((detalle) => {
      const variant = detalle.productoVarianteId
        ? variantMap.get(detalle.productoVarianteId)
        : null;
      return {
        productoVarianteId: variant?.id ?? null,
        descripcion: this.clean(
          detalle.descripcion || variant?.producto.nombre || 'Producto',
        ),
        cantidad: this.parsePositiveDecimal(detalle.cantidad, 'cantidad'),
        unidadMedida: (detalle.unidadMedida ?? 'NIU').toUpperCase(),
        codigoProducto:
          this.optional(detalle.codigoProducto) ??
          variant?.producto.publicId ??
          variant?.id.toString() ??
          null,
        pesoUnitario: detalle.pesoUnitario
          ? this.parsePositiveDecimal(detalle.pesoUnitario, 'pesoUnitario')
          : null,
      };
    });
  }

  private async resolveCatalogoParticipantes(
    empresaId: bigint,
    ids?: string[],
  ) {
    if (!ids?.length) {
      return [];
    }
    const items = await this.prisma.catalogoTransporteParticipante.findMany({
      where: {
        publicId: { in: ids },
        empresaId,
        activo: true,
        deletedAt: null,
      },
    });
    if (items.length !== ids.length) {
      throw new NotFoundException('Uno o mas participantes no encontrados');
    }

    return items.map((item) =>
      this.toParticipanteCreateData({
        tipo: item.tipo,
        tipoDocumento: item.tipoDocumento,
        numeroDocumento: item.numeroDocumento,
        nombres: item.nombres ?? undefined,
        apellidos: item.apellidos ?? undefined,
        razonSocial: item.razonSocial ?? undefined,
        licencia: item.licencia ?? undefined,
        registroMtc: item.registroMtc ?? undefined,
      }),
    );
  }

  private async resolveCatalogoVehiculos(empresaId: bigint, ids?: string[]) {
    if (!ids?.length) {
      return [];
    }
    const items = await this.prisma.catalogoVehiculo.findMany({
      where: {
        publicId: { in: ids },
        empresaId,
        activo: true,
        deletedAt: null,
      },
    });
    if (items.length !== ids.length) {
      throw new NotFoundException('Uno o mas vehiculos no encontrados');
    }

    return items.map((item) =>
      this.toVehiculoCreateData({ placa: item.placa }),
    );
  }

  private async validateCompany(empresaId: bigint) {
    const company = await this.prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { ruc: true, razonSocial: true },
    });
    if (
      !company?.ruc ||
      !/^\d{11}$/.test(company.ruc) ||
      !company.razonSocial
    ) {
      throw new BadRequestException(
        'La empresa requiere RUC y razon social para emitir guias',
      );
    }
  }

  private async resolveSucursal(empresaId: bigint, sucursalId?: string) {
    const where = sucursalId
      ? {
          id: this.parseId(sucursalId, 'sucursalId'),
          empresaId,
          estado: 'activo' as const,
        }
      : { empresaId, esPrincipal: true };
    const sucursal = await this.prisma.sucursal.findFirst({ where });
    if (!sucursal) {
      throw new NotFoundException('Sucursal no encontrada');
    }
    return sucursal;
  }

  private async resolvePunto(
    empresaId: bigint,
    sucursalId: string | undefined,
    ubigeo: string | undefined,
    direccion: string | undefined,
    label: string,
  ) {
    if (sucursalId) {
      const sucursal = await this.prisma.sucursal.findFirst({
        where: {
          id: this.parseId(sucursalId, `sucursal${label}Id`),
          empresaId,
        },
      });
      if (!sucursal) {
        throw new NotFoundException(`Sucursal de ${label} no encontrada`);
      }
      return {
        sucursalId: sucursal.id,
        ubigeo: sucursal.ubigeo,
        direccion: sucursal.direccion,
      };
    }

    if (!ubigeo || !direccion) {
      throw new BadRequestException(
        `Debe indicar sucursal o ubigeo/direccion de ${label}`,
      );
    }
    this.validateUbigeo(ubigeo, `ubigeo${label}`);
    return {
      sucursalId: null,
      ubigeo: this.clean(ubigeo),
      direccion: this.clean(direccion),
    };
  }

  private async resolveSerie(
    empresaId: bigint,
    sucursalId: bigint,
    requestedSerie?: string,
  ) {
    const where: Prisma.SerieComprobanteWhereInput = {
      empresaId,
      tipoComprobante: VentaTipoComprobante.guia_remision,
      activo: true,
      ...(requestedSerie
        ? { serie: this.clean(requestedSerie).toUpperCase() }
        : { esPrincipal: true }),
      OR: [
        { aplicaTodasSucursales: true },
        { sucursales: { some: { sucursalId } } },
      ],
    };

    const serie = await this.prisma.serieComprobante.findFirst({
      where,
      orderBy: [{ esPrincipal: 'desc' }, { id: 'asc' }],
    });
    if (!serie) {
      throw new NotFoundException('Serie de guia de remision no encontrada');
    }
    if (!/^T\d{3}$/.test(serie.serie.toUpperCase())) {
      throw new BadRequestException('La serie de guia debe tener formato T###');
    }
    return serie;
  }

  private validateBeforeSave(params: {
    dto: CreateGuiaRemisionDto;
    detalles: unknown[];
    participantes: ReturnType<
      GuiaRemisionService['toParticipanteCreateData']
    >[];
    vehiculos: ReturnType<GuiaRemisionService['toVehiculoCreateData']>[];
  }) {
    const { dto, detalles, participantes, vehiculos } = params;
    if (!detalles.length) {
      throw new BadRequestException('La guia requiere al menos un detalle');
    }
    if (dto.motivoTraslado === '13' && !dto.descripcionMotivo?.trim()) {
      throw new BadRequestException('El motivo 13 requiere descripcion');
    }
    this.validateDestinatario(dto.destinatarioTipoDoc, dto.destinatarioNroDoc);

    if (['01', '02', '03'].includes(dto.motivoTraslado ?? '04')) {
      if (!dto.documentosRelacionados?.length) {
        throw new BadRequestException(
          'El motivo seleccionado requiere documento relacionado',
        );
      }
    }

    if (dto.modalidadTransporte === '01') {
      if (!dto.fechaEntregaTransportista) {
        throw new BadRequestException(
          'El transporte publico requiere fecha de entrega al transportista',
        );
      }
      const transportista = participantes.find(
        (p) => p.tipo === 'transportista',
      );
      if (!transportista) {
        throw new BadRequestException(
          'El transporte publico requiere transportista',
        );
      }
      if (
        transportista.tipoDocumento !== '6' ||
        !/^\d{11}$/.test(transportista.numeroDocumento) ||
        !transportista.razonSocial ||
        !transportista.registroMtc
      ) {
        throw new BadRequestException(
          'El transportista requiere RUC, razon social y registro MTC',
        );
      }
    }

    if (dto.modalidadTransporte === '02') {
      const conductor = participantes.find(
        (p) => p.tipo === 'conductor' && p.esPrincipal,
      );
      if (!conductor) {
        throw new BadRequestException(
          'El transporte privado requiere conductor principal',
        );
      }
      if (!/^\d{8}$/.test(conductor.numeroDocumento) || !conductor.licencia) {
        throw new BadRequestException(
          'El conductor principal requiere DNI de 8 digitos y licencia',
        );
      }
      if (!vehiculos.some((v) => v.esPrincipal)) {
        throw new BadRequestException(
          'El transporte privado requiere vehiculo principal',
        );
      }
    }
  }

  private validateBeforeEmit(guia: GuiaWithRelations) {
    this.validateDestinatario(
      guia.destinatarioTipoDoc,
      guia.destinatarioNroDoc,
    );
    this.validateUbigeo(guia.ubigeoPartida, 'ubigeoPartida');
    this.validateUbigeo(guia.ubigeoLlegada, 'ubigeoLlegada');
    if (guia.pesoBrutoTotal.lte(0)) {
      throw new BadRequestException('pesoBrutoTotal debe ser mayor a 0');
    }
    this.validateBeforeSave({
      dto: {
        fechaInicioTraslado: guia.fechaInicioTraslado.toISOString(),
        fechaEntregaTransportista:
          guia.fechaEntregaTransportista?.toISOString(),
        motivoTraslado: guia.motivoTraslado,
        descripcionMotivo: guia.descripcionMotivo ?? undefined,
        modalidadTransporte: guia.modalidadTransporte,
        pesoBrutoTotal: guia.pesoBrutoTotal.toString(),
        destinatarioTipoDoc: guia.destinatarioTipoDoc,
        destinatarioNroDoc: guia.destinatarioNroDoc,
        destinatarioRazonSocial: guia.destinatarioRazonSocial,
        detalles: [],
        documentosRelacionados: guia.documentosRelacionados.map((doc) => ({
          tipoDocumento: doc.tipoDocumento,
          serie: doc.serie,
          numero: doc.numero,
        })),
      },
      detalles: guia.detalles,
      participantes: guia.participantes,
      vehiculos: guia.vehiculos,
    });
  }

  private validateDestinatario(tipoDoc: string, nroDoc: string) {
    if (tipoDoc === '6' && !/^\d{11}$/.test(nroDoc)) {
      throw new BadRequestException(
        'El RUC del destinatario debe tener 11 digitos',
      );
    }
    if (tipoDoc === '1' && !/^\d{8}$/.test(nroDoc)) {
      throw new BadRequestException(
        'El DNI del destinatario debe tener 8 digitos',
      );
    }
  }

  private validateUbigeo(value: string, fieldName: string) {
    if (!/^\d{6}$/.test(value)) {
      throw new BadRequestException(`${fieldName} debe tener 6 digitos`);
    }
  }

  private toParticipanteCreateData(item: GuiaRemisionParticipanteDto) {
    return {
      tipo: item.tipo,
      tipoDocumento: this.clean(item.tipoDocumento),
      numeroDocumento: this.clean(item.numeroDocumento),
      nombres: this.optional(item.nombres),
      apellidos: this.optional(item.apellidos),
      razonSocial: this.optional(item.razonSocial),
      licencia: this.optional(item.licencia)?.toUpperCase() ?? null,
      registroMtc: this.optional(item.registroMtc)?.toUpperCase() ?? null,
      esPrincipal:
        item.esPrincipal ??
        item.tipo === GuiaRemisionParticipanteTipo.conductor,
    };
  }

  private toVehiculoCreateData(item: GuiaRemisionVehiculoDto) {
    return {
      placa: this.clean(item.placa).toUpperCase(),
      esPrincipal: item.esPrincipal ?? true,
    };
  }

  private async findEntity(empresaId: bigint, publicId: string) {
    const guia = await this.prisma.guiaRemision.findFirst({
      where: { empresaId, publicId },
      include: guiaInclude,
    });
    if (!guia) {
      throw new NotFoundException('Guia de remision no encontrada');
    }
    return guia;
  }

  private toResponse(guia: GuiaWithRelations) {
    return {
      publicId: guia.publicId,
      serie: guia.serie,
      numero: guia.numero,
      correlativo: guia.correlativo,
      fechaEmision: guia.fechaEmision.toISOString().slice(0, 10),
      fechaInicioTraslado: guia.fechaInicioTraslado.toISOString().slice(0, 10),
      fechaEntregaTransportista:
        guia.fechaEntregaTransportista?.toISOString().slice(0, 10) ?? null,
      motivoTraslado: guia.motivoTraslado,
      descripcionMotivo: guia.descripcionMotivo,
      modalidadTransporte: guia.modalidadTransporte,
      pesoBrutoTotal: guia.pesoBrutoTotal.toString(),
      unidadPeso: guia.unidadPeso,
      numeroBultos: guia.numeroBultos,
      observaciones: guia.observaciones,
      partida: {
        sucursalId: guia.sucursalPartidaId?.toString() ?? null,
        sucursalNombre: guia.sucursalPartida?.nombre ?? null,
        ubigeo: guia.ubigeoPartida,
        direccion: guia.direccionPartida,
      },
      llegada: {
        sucursalId: guia.sucursalLlegadaId?.toString() ?? null,
        sucursalNombre: guia.sucursalLlegada?.nombre ?? null,
        ubigeo: guia.ubigeoLlegada,
        direccion: guia.direccionLlegada,
      },
      destinatario: {
        tipoDocumento: guia.destinatarioTipoDoc,
        numeroDocumento: guia.destinatarioNroDoc,
        razonSocial: guia.destinatarioRazonSocial,
      },
      estado: guia.estado,
      sunat: {
        estado: guia.sunatEstado,
        codigo: guia.sunatCodigo,
        mensaje: guia.sunatMensaje,
        hash: guia.sunatHash,
        ticket: guia.sunatTicket,
        xmlDisponible: Boolean(guia.sunatXmlKey),
        cdrDisponible: Boolean(guia.sunatCdrKey),
        pdfDisponible: Boolean(guia.sunatPdfKey),
        enviadoAt: guia.sunatEnviadoAt?.toISOString() ?? null,
        respondidoAt: guia.sunatRespondidoAt?.toISOString() ?? null,
      },
      sucursal: {
        id: guia.sucursal.id.toString(),
        nombre: guia.sucursal.nombre,
      },
      creadoPor: guia.creadoPor
        ? {
            id: guia.creadoPor.id.toString(),
            nombre: guia.creadoPor.nombre,
            apellido: guia.creadoPor.apellido,
          }
        : null,
      detalles: guia.detalles.map((detalle) => ({
        id: detalle.id.toString(),
        productoVarianteId: detalle.productoVarianteId?.toString() ?? null,
        productoNombre: detalle.productoVariante?.producto.nombre ?? null,
        descripcion: detalle.descripcion,
        cantidad: detalle.cantidad.toString(),
        unidadMedida: detalle.unidadMedida,
        codigoProducto: detalle.codigoProducto,
        pesoUnitario: detalle.pesoUnitario?.toString() ?? null,
      })),
      documentosRelacionados: guia.documentosRelacionados.map((doc) => ({
        tipoDocumento: doc.tipoDocumento,
        serie: doc.serie,
        numero: doc.numero,
      })),
      participantes: guia.participantes.map((item) => ({
        tipo: item.tipo,
        tipoDocumento: item.tipoDocumento,
        numeroDocumento: item.numeroDocumento,
        nombres: item.nombres,
        apellidos: item.apellidos,
        razonSocial: item.razonSocial,
        licencia: item.licencia,
        registroMtc: item.registroMtc,
        esPrincipal: item.esPrincipal,
      })),
      vehiculos: guia.vehiculos.map((item) => ({
        placa: item.placa,
        esPrincipal: item.esPrincipal,
      })),
      createdAt: guia.createdAt.toISOString(),
      updatedAt: guia.updatedAt.toISOString(),
    };
  }

  private mapVentaTipoDocumento(value?: string) {
    if (!value) {
      return null;
    }
    if (value === '01') {
      return VentaTipoComprobante.factura;
    }
    if (value === '03') {
      return VentaTipoComprobante.boleta;
    }
    throw new BadRequestException('tipoDocumento debe ser 01 o 03');
  }

  private parseDate(value: string, fieldName: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`${fieldName} debe ser una fecha valida`);
    }
    return date;
  }

  private parseId(value: string, fieldName: string) {
    if (!/^\d+$/.test(String(value))) {
      throw new BadRequestException(`${fieldName} debe ser un id valido`);
    }
    return BigInt(value);
  }

  private parseOptionalId(value: string | undefined, fieldName: string) {
    return value ? this.parseId(value, fieldName) : null;
  }

  private parsePositiveDecimal(value: string, fieldName: string) {
    try {
      const amount = new Prisma.Decimal(value);
      if (!amount.isFinite() || amount.lte(0)) {
        throw new Error('Invalid decimal');
      }
      return amount;
    } catch {
      throw new BadRequestException(`${fieldName} debe ser mayor a 0`);
    }
  }

  private optional(value?: string) {
    const clean = value?.trim().replace(/\s+/g, ' ');
    return clean || null;
  }

  private clean(value: string) {
    return value.trim().replace(/\s+/g, ' ');
  }

  private getDefaultPaginationLimit() {
    const value = Number(
      this.configService.get<string>('PAGINATION_DEFAULT_LIMIT') ?? 12,
    );
    return Number.isInteger(value) && value > 0 ? value : 12;
  }
}
