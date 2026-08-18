import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EmpresaUsuarioEstado,
  Prisma,
  SucursalTipo,
  UsuarioEstado,
} from '@prisma/client';
import { getCommercialScope } from '../../common/commercial-access';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { PlansService } from '../plans/plans.service';
import { CreateUserDto } from './dto/create-user.dto';
import { FindUsersQueryDto } from './dto/find-users-query.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  userModuleKeySet,
  userModuleMap,
  userModules,
  warehouseUserModuleKeySet,
} from './user-modules';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly plansService: PlansService,
  ) {}

  async findAll(
    empresaId: bigint,
    actor: JwtPayload,
    query: FindUsersQueryDto,
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? this.getDefaultPaginationLimit();
    const search = query.search?.trim();
    const usuarioWhere: Prisma.UsuarioWhereInput = {
      ...(query.estado ? { estado: query.estado } : {}),
      ...(search
        ? {
            OR: [
              { nombre: { contains: search, mode: 'insensitive' } },
              { apellido: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              { telefono: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const where: Prisma.EmpresaUsuarioWhereInput = {
      empresaId,
      ...(getCommercialScope(actor).branchId
        ? { sucursalId: getCommercialScope(actor).branchId }
        : {}),
      ...(Object.keys(usuarioWhere).length ? { usuario: usuarioWhere } : {}),
    };

    const [users, total, activeTotal, inactiveTotal] =
      await this.prisma.$transaction([
        this.prisma.empresaUsuario.findMany({
          where,
          include: {
            usuario: true,
            roles: {
              include: { rol: true },
              orderBy: { rol: { codigo: 'asc' } },
            },
            modulos: true,
            sucursal: true,
          },
          orderBy: [
            { usuario: { estado: 'asc' } },
            { usuario: { nombre: 'asc' } },
          ],
          skip: (page - 1) * limit,
          take: limit,
        }),
        this.prisma.empresaUsuario.count({ where }),
        this.prisma.empresaUsuario.count({
          where: { empresaId, usuario: { estado: UsuarioEstado.activo } },
        }),
        this.prisma.empresaUsuario.count({
          where: { empresaId, usuario: { estado: UsuarioEstado.inactivo } },
        }),
      ]);

    return {
      data: users.map((user) => this.toResponse(user)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        activeTotal,
        inactiveTotal,
        adminTotal: 0,
        salesTotal: 0,
        warehouseTotal: 0,
      },
    };
  }

  async create(empresaId: bigint, actor: JwtPayload, dto: CreateUserDto) {
    if (dto.password !== dto.confirmarPassword) {
      throw new BadRequestException('Las contrasenas no coinciden');
    }

    const email = dto.email.trim().toLowerCase();
    const moduleKeys = this.cleanModuleKeys(dto.moduleKeys);
    await this.plansService.assertModulesIncluded(empresaId, moduleKeys);
    const sucursal = await this.resolveGrantedBranch(
      empresaId,
      actor,
      dto.sucursalId,
    );
    this.assertWarehouseModules(sucursal?.tipo, moduleKeys);
    this.assertGrantedVisibility(actor, dto.visibilidadOperaciones);

    try {
      const created = await this.prisma.$transaction(
        async (tx) => {
          await this.plansService.assertResourceLimits(tx, empresaId, {
            users: 1,
          });
          const usuario = await tx.usuario.create({
            data: {
              nombre: this.cleanText(dto.nombre),
              apellido: this.cleanOptionalText(dto.apellido),
              email,
              telefono: this.cleanOptionalText(dto.telefono),
              passwordHash: await bcrypt.hash(dto.password, 10),
              estado: UsuarioEstado.activo,
              emailVerificado: true,
            },
          });

          const empresaUsuario = await tx.empresaUsuario.create({
            data: {
              empresaId,
              usuarioId: usuario.id,
              estado: EmpresaUsuarioEstado.activo,
              sucursalId: sucursal?.id ?? null,
              visibilidadOperaciones: dto.visibilidadOperaciones,
              modulos: {
                create: moduleKeys.map((moduleKey) => ({ moduleKey })),
              },
            },
            include: {
              usuario: true,
              roles: { include: { rol: true } },
              modulos: true,
              sucursal: true,
            },
          });

          return empresaUsuario;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      return this.toResponse(created);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async findOne(
    empresaId: bigint,
    actor: JwtPayload,
    empresaUsuarioId: bigint,
  ) {
    const user = await this.findCompanyUser(empresaId, empresaUsuarioId, actor);
    return this.toResponse(user);
  }

  async update(
    empresaId: bigint,
    actor: JwtPayload,
    empresaUsuarioId: bigint,
    dto: UpdateUserDto,
  ) {
    const current = await this.findCompanyUser(
      empresaId,
      empresaUsuarioId,
      actor,
    );
    this.ensureManageableUser(current);

    const moduleKeys = this.cleanModuleKeys(dto.moduleKeys);
    const availableModuleKeys = await this.plansService.assertModulesIncluded(
      empresaId,
      moduleKeys,
    );
    const preservedModuleKeys = current.modulos
      .map(({ moduleKey }) => moduleKey)
      .filter((moduleKey) => !availableModuleKeys.has(moduleKey));
    const storedModuleKeys = Array.from(
      new Set([...preservedModuleKeys, ...moduleKeys]),
    );
    const email = dto.email.trim().toLowerCase();
    const sucursal = await this.resolveGrantedBranch(
      empresaId,
      actor,
      dto.sucursalId,
    );
    this.assertWarehouseModules(sucursal?.tipo, moduleKeys);
    this.assertGrantedVisibility(actor, dto.visibilidadOperaciones);

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        await tx.usuario.update({
          where: { id: current.usuarioId },
          data: {
            nombre: this.cleanText(dto.nombre),
            apellido: this.cleanOptionalText(dto.apellido),
            email,
            telefono: this.cleanOptionalText(dto.telefono),
          },
        });

        await tx.empresaUsuarioModulo.deleteMany({
          where: { empresaUsuarioId },
        });
        await tx.empresaUsuarioModulo.createMany({
          data: storedModuleKeys.map((moduleKey) => ({
            empresaUsuarioId,
            moduleKey,
          })),
          skipDuplicates: true,
        });
        await tx.empresaUsuario.update({
          where: { id: empresaUsuarioId },
          data: {
            sucursalId: sucursal?.id ?? null,
            visibilidadOperaciones: dto.visibilidadOperaciones,
          },
        });

        return tx.empresaUsuario.findFirstOrThrow({
          where: { id: empresaUsuarioId, empresaId },
          include: {
            usuario: true,
            roles: {
              include: { rol: true },
              orderBy: { rol: { codigo: 'asc' } },
            },
            modulos: true,
            sucursal: true,
          },
        });
      });

      return this.toResponse(updated);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async updateStatus(
    empresaId: bigint,
    actor: JwtPayload,
    empresaUsuarioId: bigint,
    dto: UpdateUserStatusDto,
  ) {
    const current = await this.findCompanyUser(
      empresaId,
      empresaUsuarioId,
      actor,
    );
    this.ensureManageableUser(current);

    const updated = await this.prisma.$transaction(
      async (tx) => {
        if (
          dto.estado === UsuarioEstado.activo &&
          (current.estado !== EmpresaUsuarioEstado.activo ||
            current.usuario.estado !== UsuarioEstado.activo)
        ) {
          await this.plansService.assertResourceLimits(tx, empresaId, {
            users: 1,
          });
        }

        await tx.usuario.update({
          where: { id: current.usuarioId },
          data: { estado: dto.estado },
        });
        await tx.empresaUsuario.update({
          where: { id: empresaUsuarioId },
          data: { estado: dto.estado },
        });

        return tx.empresaUsuario.findFirstOrThrow({
          where: { id: empresaUsuarioId, empresaId },
          include: {
            usuario: true,
            roles: {
              include: { rol: true },
              orderBy: { rol: { codigo: 'asc' } },
            },
            modulos: true,
            sucursal: true,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return this.toResponse(updated);
  }

  async remove(empresaId: bigint, actor: JwtPayload, empresaUsuarioId: bigint) {
    const current = await this.findCompanyUser(
      empresaId,
      empresaUsuarioId,
      actor,
    );
    this.ensureManageableUser(current);

    await this.prisma.usuario.delete({ where: { id: current.usuarioId } });

    return { success: true };
  }

  private getDefaultPaginationLimit() {
    const defaultLimit = Number(
      this.configService.get<string>('PAGINATION_DEFAULT_LIMIT') ?? 12,
    );
    const maxLimit = Number(
      this.configService.get<string>('PAGINATION_MAX_LIMIT') ?? 100,
    );

    if (!Number.isInteger(defaultLimit) || defaultLimit <= 0) {
      return 12;
    }

    if (!Number.isInteger(maxLimit) || maxLimit <= 0) {
      return defaultLimit;
    }

    return Math.min(defaultLimit, maxLimit);
  }

  private cleanText(value: string) {
    return value.trim().replace(/\s+/g, ' ');
  }

  private cleanOptionalText(value?: string) {
    const cleanValue = value?.trim().replace(/\s+/g, ' ');
    return cleanValue || null;
  }

  private cleanModuleKeys(moduleKeys: string[]) {
    const cleanKeys = Array.from(
      new Set(moduleKeys.map((moduleKey) => moduleKey.trim()).filter(Boolean)),
    );

    if (cleanKeys.length === 0) {
      throw new BadRequestException('Selecciona al menos un modulo');
    }

    const invalidKey = cleanKeys.find(
      (moduleKey) => !userModuleKeySet.has(moduleKey),
    );
    if (invalidKey) {
      throw new BadRequestException(`El modulo ${invalidKey} no existe`);
    }

    return this.expandStockKardexModule(cleanKeys);
  }

  private expandStockKardexModule(moduleKeys: string[]) {
    const selected = new Set(moduleKeys);
    if (selected.has('stock-movimientos') || selected.has('stock-traspasos')) {
      selected.add('stock-kardex');
    }
    return Array.from(selected);
  }

  private async findCompanyUser(
    empresaId: bigint,
    empresaUsuarioId: bigint,
    actor?: JwtPayload,
  ) {
    const actorBranchId = actor ? getCommercialScope(actor).branchId : null;
    const user = await this.prisma.empresaUsuario.findFirst({
      where: {
        id: empresaUsuarioId,
        empresaId,
        ...(actorBranchId ? { sucursalId: actorBranchId } : {}),
      },
      include: {
        usuario: true,
        roles: { include: { rol: true }, orderBy: { rol: { codigo: 'asc' } } },
        modulos: true,
        sucursal: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    return user;
  }

  private async resolveGrantedBranch(
    empresaId: bigint,
    actor: JwtPayload,
    requestedId?: string | null,
  ) {
    const actorScope = getCommercialScope(actor);
    if (actorScope.branchId) {
      if (!requestedId || BigInt(requestedId) !== actorScope.branchId) {
        throw new BadRequestException(
          'No puedes asignar una sucursal fuera de tu alcance',
        );
      }
      const branch = await this.prisma.sucursal.findFirst({
        where: { id: actorScope.branchId, empresaId, estado: 'activo' },
        select: { id: true, tipo: true },
      });
      if (!branch)
        throw new BadRequestException('La sucursal no existe o esta inactiva');
      return branch;
    }

    if (!requestedId) return null;
    const branchId = BigInt(requestedId);
    const branch = await this.prisma.sucursal.findFirst({
      where: { id: branchId, empresaId, estado: 'activo' },
      select: { id: true, tipo: true },
    });
    if (!branch)
      throw new BadRequestException('La sucursal no existe o esta inactiva');
    return branch;
  }

  private assertWarehouseModules(
    tipo: SucursalTipo | undefined,
    moduleKeys: string[],
  ) {
    if (tipo !== SucursalTipo.almacen) return;
    const invalidKey = moduleKeys.find(
      (key) => !warehouseUserModuleKeySet.has(key),
    );
    if (invalidKey) {
      throw new BadRequestException(
        'Los usuarios de almacen solo pueden acceder a inventario, catalogos y GRE',
      );
    }
  }

  private assertGrantedVisibility(
    actor: JwtPayload,
    requested: CreateUserDto['visibilidadOperaciones'],
  ) {
    const scope = getCommercialScope(actor);
    if (
      !scope.isOwner &&
      scope.visibility === 'propias' &&
      requested === 'todas'
    ) {
      throw new BadRequestException(
        'No puedes conceder una visibilidad superior a la tuya',
      );
    }
  }

  private ensureManageableUser(
    user: Prisma.EmpresaUsuarioGetPayload<{
      include: {
        usuario: true;
        roles: { include: { rol: true } };
        modulos: true;
        sucursal: true;
      };
    }>,
  ) {
    if (user.roles.some(({ rol }) => rol.codigo === 'OWNER')) {
      throw new BadRequestException('No se puede modificar el superadmin');
    }
  }

  private handlePrismaError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('Ya existe un usuario con ese correo');
    }

    throw error;
  }

  private toResponse(
    user: Prisma.EmpresaUsuarioGetPayload<{
      include: {
        usuario: true;
        roles: { include: { rol: true } };
        modulos: true;
        sucursal: true;
      };
    }>,
  ) {
    const isOwner = user.roles.some(({ rol }) => rol.codigo === 'OWNER');
    const moduleKeys = isOwner
      ? userModules.map((module) => module.key)
      : this.expandStockKardexModule(
          user.modulos.map((module) => module.moduleKey),
        );
    const modules = moduleKeys.flatMap((moduleKey) => {
      const module = userModuleMap.get(moduleKey);
      return module ? [module] : [];
    });

    return {
      id: user.usuario.id.toString(),
      empresaUsuarioId: user.id.toString(),
      nombre: user.usuario.nombre,
      apellido: user.usuario.apellido,
      email: user.usuario.email,
      telefono: user.usuario.telefono,
      estado: user.usuario.estado,
      roles: user.roles.map(({ rol }) => ({
        code: rol.codigo,
        label: rol.nombre,
      })),
      moduleKeys,
      modules,
      isOwner,
      sucursal:
        isOwner || !user.sucursal
          ? null
          : {
              id: user.sucursal.id.toString(),
              nombre: user.sucursal.nombre,
              estado: user.sucursal.estado,
            },
      visibilidadOperaciones: isOwner ? 'todas' : user.visibilidadOperaciones,
      createdAt: user.usuario.createdAt,
      updatedAt: user.usuario.updatedAt,
    };
  }
}
