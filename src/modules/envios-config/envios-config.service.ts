import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export const ENVIO_METODOS = [
  { metodo: 'SHALOM', nombre: 'Shalom' },
  { metodo: 'OLVA', nombre: 'Olva' },
] as const;

export type EnvioMetodo = (typeof ENVIO_METODOS)[number]['metodo'];

@Injectable()
export class EnviosConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(empresaId: bigint) {
    const configs = await this.prisma.empresaEnvioConfig.findMany({
      where: { empresaId },
      select: { metodo: true, activo: true },
    });
    const activoByMetodo = new Map(
      configs.map((config) => [config.metodo, config.activo]),
    );

    return ENVIO_METODOS.map(({ metodo, nombre }) => ({
      metodo,
      nombre,
      activo: activoByMetodo.get(metodo) ?? true,
    }));
  }

  async update(empresaId: bigint, metodo: string, activo: boolean) {
    const known = ENVIO_METODOS.find((item) => item.metodo === metodo);
    if (!known) {
      throw new BadRequestException('Metodo de envio no valido');
    }

    const config = await this.prisma.empresaEnvioConfig.upsert({
      where: {
        empresaId_metodo: { empresaId, metodo },
      },
      update: { activo },
      create: { empresaId, metodo, activo },
    });

    return {
      metodo: config.metodo,
      nombre: known.nombre,
      activo: config.activo,
    };
  }

  async enabledMetodos(empresaId: bigint) {
    return (await this.findAll(empresaId))
      .filter((item) => item.activo)
      .map((item) => item.metodo);
  }

  async isEnabled(empresaId: bigint, metodo: string) {
    if (!ENVIO_METODOS.some((item) => item.metodo === metodo)) {
      return false;
    }
    const enabled = await this.enabledMetodos(empresaId);
    return enabled.some((item) => item === metodo);
  }
}
