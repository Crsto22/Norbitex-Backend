import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export const ENVIO_METODOS = [
  { metodo: 'RECOJO', nombre: 'Recojo en tienda', tipo: 'recojo' },
  { metodo: 'MOTORIZADO', nombre: 'Motorizado', tipo: 'domicilio' },
  { metodo: 'DOMICILIO', nombre: 'Envío a domicilio', tipo: 'domicilio' },
  { metodo: 'SHALOM', nombre: 'Shalom', tipo: 'courier' },
  { metodo: 'OLVA', nombre: 'Olva', tipo: 'courier' },
] as const;

export type EnvioMetodo = (typeof ENVIO_METODOS)[number]['metodo'];
export type EnvioMetodoTipo = (typeof ENVIO_METODOS)[number]['tipo'];

export const envioPreviewDefaultColor = '#101D69';

export function getEnvioMetodo(metodo: string | null | undefined) {
  return ENVIO_METODOS.find((item) => item.metodo === metodo) ?? null;
}

@Injectable()
export class EnviosConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(empresaId: bigint) {
    const configs = await this.prisma.empresaEnvioConfig.findMany({
      where: { empresaId },
      select: { metodo: true, activo: true, direccion: true },
    });
    const configByMetodo = new Map(
      configs.map((config) => [config.metodo, config]),
    );

    return ENVIO_METODOS.map(({ metodo, nombre, tipo }) => {
      const config = configByMetodo.get(metodo);
      return {
        metodo,
        nombre,
        tipo,
        activo: config?.activo ?? true,
        direccion: config?.direccion ?? null,
      };
    });
  }

  async update(
    empresaId: bigint,
    metodo: string,
    activo: boolean,
    direccion?: string | null,
  ) {
    const known = ENVIO_METODOS.find((item) => item.metodo === metodo);
    if (!known) {
      throw new BadRequestException('Metodo de envio no valido');
    }

    const direccionNormalizada =
      direccion === undefined
        ? undefined
        : direccion?.trim()
          ? direccion.trim()
          : null;

    const config = await this.prisma.empresaEnvioConfig.upsert({
      where: {
        empresaId_metodo: { empresaId, metodo },
      },
      update: {
        activo,
        ...(direccionNormalizada !== undefined
          ? { direccion: direccionNormalizada }
          : {}),
      },
      create: {
        empresaId,
        metodo,
        activo,
        direccion: direccionNormalizada ?? null,
      },
    });

    return {
      metodo: config.metodo,
      nombre: known.nombre,
      tipo: known.tipo,
      activo: config.activo,
      direccion: config.direccion,
    };
  }

  async getDespacho(empresaId: bigint) {
    const config = await this.prisma.empresaDespachoConfig.findUnique({
      where: { empresaId },
      select: { diasSemana: true, horaCorte: true, anticipacionDias: true },
    });

    return {
      diasSemana: config?.diasSemana ?? [],
      horaCorte: config?.horaCorte ?? '',
      anticipacionDias: config?.anticipacionDias ?? 0,
      configurado: config !== null,
    };
  }

  async updateDespacho(
    empresaId: bigint,
    diasSemana: number[],
    horaCorte: string,
    anticipacionDias = 0,
  ) {
    const diasNormalizados = [...new Set(diasSemana)].sort((a, b) => a - b);

    const config = await this.prisma.empresaDespachoConfig.upsert({
      where: { empresaId },
      update: { diasSemana: diasNormalizados, horaCorte, anticipacionDias },
      create: {
        empresaId,
        diasSemana: diasNormalizados,
        horaCorte,
        anticipacionDias,
      },
    });

    return {
      diasSemana: config.diasSemana,
      horaCorte: config.horaCorte,
      anticipacionDias: config.anticipacionDias,
      configurado: true,
    };
  }

  async getRecojo(empresaId: bigint) {
    const recojo = await this.prisma.empresaRecojoConfig.findUnique({
      where: { empresaId },
      select: { diasSemana: true, horaCorte: true, anticipacionDias: true },
    });

    if (recojo) {
      return {
        diasSemana: recojo.diasSemana,
        horaCorte: recojo.horaCorte,
        anticipacionDias: recojo.anticipacionDias,
        configurado: true,
        usaDespacho: false,
      };
    }

    const despacho = await this.getDespacho(empresaId);
    return {
      diasSemana: despacho.diasSemana,
      horaCorte: despacho.horaCorte,
      anticipacionDias: despacho.anticipacionDias,
      configurado: despacho.configurado,
      usaDespacho: true,
    };
  }

  async updateRecojo(
    empresaId: bigint,
    usarDespacho: boolean,
    diasSemana?: number[],
    horaCorte?: string,
    anticipacionDias = 0,
  ) {
    if (usarDespacho) {
      await this.prisma.empresaRecojoConfig.deleteMany({
        where: { empresaId },
      });
      return this.getRecojo(empresaId);
    }

    if (!diasSemana?.length) {
      throw new BadRequestException('Selecciona al menos un día de recojo');
    }
    if (!horaCorte) {
      throw new BadRequestException('Ingresa una hora de corte válida');
    }

    const diasNormalizados = [...new Set(diasSemana)].sort((a, b) => a - b);
    const config = await this.prisma.empresaRecojoConfig.upsert({
      where: { empresaId },
      update: { diasSemana: diasNormalizados, horaCorte, anticipacionDias },
      create: {
        empresaId,
        diasSemana: diasNormalizados,
        horaCorte,
        anticipacionDias,
      },
    });

    return {
      diasSemana: config.diasSemana,
      horaCorte: config.horaCorte,
      anticipacionDias: config.anticipacionDias,
      configurado: true,
      usaDespacho: false,
    };
  }

  async getPreview(empresaId: bigint) {
    const config = await this.prisma.empresaEnvioPreviewConfig.findUnique({
      where: { empresaId },
      select: {
        titulo: true,
        descripcion: true,
        colorPrimario: true,
        textoCentral: true,
        updatedAt: true,
      },
    });

    return {
      titulo: config?.titulo ?? null,
      descripcion: config?.descripcion ?? null,
      colorPrimario: config?.colorPrimario ?? envioPreviewDefaultColor,
      textoCentral: config?.textoCentral ?? null,
      configurado: Boolean(config),
      actualizadoAt: config ? config.updatedAt.toISOString() : null,
    };
  }

  async updatePreview(
    empresaId: bigint,
    data: {
      titulo?: string | null;
      descripcion?: string | null;
      colorPrimario: string;
      textoCentral?: string | null;
    },
  ) {
    const normalize = (value?: string | null) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : null;
    };

    const config = await this.prisma.empresaEnvioPreviewConfig.upsert({
      where: { empresaId },
      update: {
        titulo: normalize(data.titulo),
        descripcion: normalize(data.descripcion),
        colorPrimario: data.colorPrimario,
        textoCentral: normalize(data.textoCentral),
      },
      create: {
        empresaId,
        titulo: normalize(data.titulo),
        descripcion: normalize(data.descripcion),
        colorPrimario: data.colorPrimario,
        textoCentral: normalize(data.textoCentral),
      },
      select: {
        titulo: true,
        descripcion: true,
        colorPrimario: true,
        textoCentral: true,
        updatedAt: true,
      },
    });

    return {
      titulo: config.titulo,
      descripcion: config.descripcion,
      colorPrimario: config.colorPrimario,
      textoCentral: config.textoCentral,
      configurado: true,
      actualizadoAt: config.updatedAt.toISOString(),
    };
  }

  async enabledMetodos(empresaId: bigint) {
    return (await this.findAll(empresaId))
      .filter((item) => item.activo)
      .map((item) => item.metodo);
  }

  async enabledCourierMetodos(empresaId: bigint) {
    return (await this.findAll(empresaId))
      .filter((item) => item.activo && item.tipo === 'courier')
      .map((item) => item.metodo);
  }

  async enabledMetodosDetalle(empresaId: bigint) {
    return (await this.findAll(empresaId)).filter((item) => item.activo);
  }

  async getMetodo(empresaId: bigint, metodo: string) {
    return (await this.findAll(empresaId)).find(
      (item) => item.metodo === metodo,
    );
  }

  async isEnabled(empresaId: bigint, metodo: string) {
    if (!ENVIO_METODOS.some((item) => item.metodo === metodo)) {
      return false;
    }
    const enabled = await this.enabledMetodos(empresaId);
    return enabled.some((item) => item === metodo);
  }
}
