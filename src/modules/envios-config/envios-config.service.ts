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
      select: { diasSemana: true, horaCorte: true },
    });

    return {
      diasSemana: config?.diasSemana ?? [],
      horaCorte: config?.horaCorte ?? '',
      configurado: config !== null,
    };
  }

  async updateDespacho(
    empresaId: bigint,
    diasSemana: number[],
    horaCorte: string,
  ) {
    const diasNormalizados = [...new Set(diasSemana)].sort((a, b) => a - b);

    const config = await this.prisma.empresaDespachoConfig.upsert({
      where: { empresaId },
      update: { diasSemana: diasNormalizados, horaCorte },
      create: { empresaId, diasSemana: diasNormalizados, horaCorte },
    });

    return {
      diasSemana: config.diasSemana,
      horaCorte: config.horaCorte,
      configurado: true,
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
