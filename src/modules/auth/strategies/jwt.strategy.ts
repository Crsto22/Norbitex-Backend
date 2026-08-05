import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import {
  EmpresaEstado,
  EmpresaUsuarioEstado,
  UsuarioEstado,
  SucursalTipo,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PlansService } from '../../plans/plans.service';
import { warehouseUserModuleKeySet } from '../../users/user-modules';
import { JwtPayload } from '../types/jwt-payload.type';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly plansService: PlansService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>(
        'JWT_SECRET',
        'dev_secret_change_me',
      ),
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    if (!payload.empresaId) {
      if (payload.refreshTokenVersion === undefined) {
        if (payload.setup !== 'company') {
          throw new UnauthorizedException('Sesion no valida');
        }
        return payload;
      }

      const usuario = await this.prisma.usuario.findUnique({
        where: { id: BigInt(payload.sub) },
        select: {
          estado: true,
          esSuperAdmin: true,
          refreshTokenVersion: true,
        },
      });

      if (
        !usuario ||
        usuario.estado !== UsuarioEstado.activo ||
        !usuario.esSuperAdmin ||
        usuario.refreshTokenVersion !== payload.refreshTokenVersion
      ) {
        throw new UnauthorizedException('Sesion no valida');
      }

      return {
        ...payload,
        roles: ['SUPERADMIN'],
        moduleKeys: [],
      };
    }

    const companyUser = await this.prisma.empresaUsuario.findFirst({
      where: {
        usuarioId: BigInt(payload.sub),
        empresaId: BigInt(payload.empresaId),
        estado: EmpresaUsuarioEstado.activo,
        usuario: { estado: UsuarioEstado.activo },
        empresa: { estado: EmpresaEstado.activa },
      },
      select: {
        usuario: { select: { refreshTokenVersion: true } },
        empresa: {
          select: {
            planCodigo: true,
            planInicioAt: true,
            planFinAt: true,
          },
        },
        roles: { select: { rol: { select: { codigo: true } } } },
        modulos: { select: { moduleKey: true } },
        sucursalId: true,
        sucursal: { select: { tipo: true } },
        visibilidadOperaciones: true,
      },
    });

    if (
      !companyUser ||
      (payload.refreshTokenVersion !== undefined &&
        companyUser.usuario.refreshTokenVersion !== payload.refreshTokenVersion)
    ) {
      throw new UnauthorizedException('Sesion no valida');
    }

    const roles = companyUser.roles.map(({ rol }) => rol.codigo);
    const planModuleKeys = this.plansService.getEffectiveModuleKeys(
      companyUser.empresa,
      roles,
      companyUser.modulos.map(({ moduleKey }) => moduleKey),
    );
    const warehouseAssigned =
      !roles.includes('OWNER') &&
      companyUser.sucursal?.tipo === SucursalTipo.almacen;
    const moduleKeys = warehouseAssigned
      ? planModuleKeys.filter((key) => warehouseUserModuleKeySet.has(key))
      : planModuleKeys;

    return {
      ...payload,
      roles,
      moduleKeys,
      planCode: companyUser.empresa.planCodigo,
      planStatus: this.plansService.getStatus(companyUser.empresa),
      planStartsAt: companyUser.empresa.planInicioAt.toISOString(),
      planEndsAt: companyUser.empresa.planFinAt?.toISOString() ?? null,
      sucursalId: roles.includes('OWNER')
        ? null
        : (companyUser.sucursalId?.toString() ?? null),
      sucursalTipo: roles.includes('OWNER')
        ? null
        : (companyUser.sucursal?.tipo ?? null),
      visibilidadOperaciones: roles.includes('OWNER')
        ? 'todas'
        : companyUser.visibilidadOperaciones,
    };
  }
}
