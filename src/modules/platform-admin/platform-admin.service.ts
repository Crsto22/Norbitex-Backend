import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EmpresaEstado,
  EmpresaUsuarioEstado,
  PagoSuscripcionEstado,
  PlanCodigo,
  Prisma,
  ProductoTipo,
  SucursalTipo,
  UsuarioEstado,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { FindPlatformAuditQueryDto } from './dto/find-platform-audit-query.dto';
import { FindPlatformCompaniesQueryDto } from './dto/find-platform-companies-query.dto';
import {
  CreatePlatformUserDto,
  FindPlatformUsersQueryDto,
  UpdatePlatformUserStatusDto,
} from './dto/platform-admin-users.dto';
import { PlansService } from '../plans/plans.service';
import type { PlatformDashboardDateFilter } from './dto/platform-dashboard.dto';

const planColors: Record<PlanCodigo, string> = {
  prueba: '#2563eb',
  basico: '#06b6d4',
  emprendedor: '#10b981',
  crecimiento: '#f59e0b',
  empresarial: '#8b5cf6',
  pos_basico: '#0ea5e9',
  asistencias_basico: '#14b8a6',
  asistencias_pro: '#22c55e',
  completo_emprende: '#f97316',
  completo_empresa: '#7c3aed',
};

type MonthBucket = {
  label: string;
  start: Date;
  end: Date;
};

const platformUserSelect = {
  id: true,
  nombre: true,
  apellido: true,
  email: true,
  telefono: true,
  estado: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UsuarioSelect;

@Injectable()
export class PlatformAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plansService: PlansService,
  ) {}

  async getDashboard(
    now = new Date(),
    dateFilter: PlatformDashboardDateFilter = 'month',
  ) {
    const period = this.buildDashboardPeriod(dateFilter, now);
    const [
      totalCompanies,
      companiesThisMonth,
      activeTrials,
      activeSubscriptions,
      expiredCompanies,
      planGroups,
      collected,
      companiesCreatedRecently,
      recentCompanies,
      commercialPlans,
    ] = await Promise.all([
      this.prisma.empresa.count(),
      this.prisma.empresa.count({
        where: { createdAt: { gte: period.start, lt: period.end } },
      }),
      this.prisma.empresa.count({
        where: {
          estado: EmpresaEstado.activa,
          planCodigo: PlanCodigo.prueba,
          planFinAt: { gt: now },
        },
      }),
      this.prisma.empresa.count({
        where: {
          estado: EmpresaEstado.activa,
          planCodigo: { not: PlanCodigo.prueba },
          OR: [{ planFinAt: null }, { planFinAt: { gt: now } }],
        },
      }),
      this.prisma.empresa.count({
        where: {
          estado: EmpresaEstado.activa,
          OR: [
            { planFinAt: { lte: now } },
            { planCodigo: PlanCodigo.prueba, planFinAt: null },
          ],
        },
      }),
      this.prisma.empresa.groupBy({
        by: ['planCodigo'],
        where: { estado: EmpresaEstado.activa },
        orderBy: { planCodigo: 'asc' },
        _count: true,
      }),
      this.prisma.pagoSuscripcion.aggregate({
        where: {
          estado: PagoSuscripcionEstado.pagado,
          createdAt: { gte: period.start, lt: period.end },
        },
        _sum: { montoTotal: true },
      }),
      this.prisma.empresa.findMany({
        where: { createdAt: { gte: period.start, lt: period.end } },
        select: { createdAt: true },
      }),
      this.prisma.empresa.findMany({
        where: { createdAt: { gte: period.start, lt: period.end } },
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: {
          id: true,
          nombreComercial: true,
          ruc: true,
          dni: true,
          estado: true,
          planCodigo: true,
          planInicioAt: true,
          planFinAt: true,
          asistenciasActiva: true,
          asistenciasTrabajadoresLimite: true,
          asistenciasPuntosQrLimite: true,
          asistenciasInicioAt: true,
          asistenciasFinAt: true,
          limitesAdicionales: true,
          createdAt: true,
        },
      }),
      this.plansService.getCatalog(),
    ]);
    const activePlanTotal = planGroups.reduce(
      (total, group) => total + group._count,
      0,
    );
    const planCountMap = new Map(
      planGroups.map((group) => [group.planCodigo, group._count]),
    );

    return {
      generatedAt: now.toISOString(),
      summary: {
        totalCompanies,
        companiesInPeriod: companiesThisMonth,
        activeTrials,
        activeSubscriptions,
        expiredCompanies,
        totalCollected: collected._sum.montoTotal?.toFixed(2) ?? '0.00',
      },
      companyTrend: period.buckets.map((bucket) => ({
        label: bucket.label,
        value: companiesCreatedRecently.filter(
          (company) =>
            company.createdAt >= bucket.start && company.createdAt < bucket.end,
        ).length,
      })),
      planDistribution: commercialPlans.map((plan) => {
        const count = planCountMap.get(plan.code) ?? 0;
        return {
          code: plan.code,
          name: plan.name,
          count,
          percentage:
            activePlanTotal > 0
              ? Number(((count * 100) / activePlanTotal).toFixed(2))
              : 0,
          color: planColors[plan.code],
        };
      }),
      recentCompanies: recentCompanies.map((company) => ({
        id: company.id.toString(),
        name: company.nombreComercial,
        document: company.ruc ?? company.dni,
        companyStatus: company.estado,
        planCode: company.planCodigo,
        planName: this.plansService.getDefinition(company.planCodigo).name,
        planStatus: this.plansService.getStatus(company, now),
        createdAt: company.createdAt.toISOString(),
        endsAt: company.planFinAt?.toISOString() ?? null,
      })),
    };
  }

  async findCompanies(query: FindPlatformCompaniesQueryDto, now = new Date()) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 12;
    const where = this.buildCompanyWhere(query, now);
    const [companies, total, stateGroups, trialTotal] = await Promise.all([
      this.prisma.empresa.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          nombreComercial: true,
          razonSocial: true,
          ruc: true,
          dni: true,
          email: true,
          telefono: true,
          estado: true,
          planCodigo: true,
          planInicioAt: true,
          planFinAt: true,
          asistenciasActiva: true,
          asistenciasTrabajadoresLimite: true,
          asistenciasPuntosQrLimite: true,
          asistenciasInicioAt: true,
          asistenciasFinAt: true,
          createdAt: true,
          usuarios: {
            where: { roles: { some: { rol: { codigo: 'OWNER' } } } },
            take: 1,
            select: {
              usuario: {
                select: {
                  nombre: true,
                  apellido: true,
                  email: true,
                },
              },
            },
          },
          _count: {
            select: {
              usuarios: true,
              sucursales: { where: { tipo: SucursalTipo.tienda } },
            },
          },
        },
      }),
      this.prisma.empresa.count({ where }),
      this.prisma.empresa.groupBy({
        by: ['estado'],
        where,
        orderBy: { estado: 'asc' },
        _count: { _all: true },
      }),
      this.prisma.empresa.count({
        where: {
          AND: [where, this.buildPlanStatusWhere('trial', now)],
        },
      }),
    ]);
    const stateCounts = new Map(
      stateGroups.map((group) => [group.estado, group._count._all]),
    );

    return {
      data: companies.map((company) => {
        const owner = company.usuarios[0]?.usuario;
        return {
          id: company.id.toString(),
          name: company.nombreComercial,
          legalName: company.razonSocial,
          document: company.ruc ?? company.dni,
          email: company.email,
          phone: company.telefono,
          state: company.estado,
          planCode: company.planCodigo,
          planName: this.plansService.getDefinition(company.planCodigo).name,
          planStatus: this.plansService.getStatus(company, now),
          startsAt: company.planInicioAt.toISOString(),
          endsAt: company.planFinAt?.toISOString() ?? null,
          createdAt: company.createdAt.toISOString(),
          owner: owner
            ? {
                name: [owner.nombre, owner.apellido].filter(Boolean).join(' '),
                email: owner.email,
              }
            : null,
          users: company._count.usuarios,
          branches: company._count.sucursales,
          attendance: this.plansService.mapAttendanceAddon(company),
        };
      }),
      meta: this.buildMeta(page, limit, total),
      summary: {
        total,
        active: stateCounts.get(EmpresaEstado.activa) ?? 0,
        inactive: stateCounts.get(EmpresaEstado.inactiva) ?? 0,
        suspended: stateCounts.get(EmpresaEstado.suspendida) ?? 0,
        trials: trialTotal,
      },
    };
  }

  async findCompany(id: string, now = new Date()) {
    let companyId: bigint;
    try {
      companyId = BigInt(id);
      if (companyId <= 0n) throw new Error();
    } catch {
      throw new BadRequestException('Identificador de empresa invalido');
    }

    const company = await this.prisma.empresa.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        nombreComercial: true,
        razonSocial: true,
        ruc: true,
        dni: true,
        email: true,
        telefono: true,
        estado: true,
        planCodigo: true,
        planInicioAt: true,
        planFinAt: true,
        asistenciasActiva: true,
        asistenciasTrabajadoresLimite: true,
        asistenciasPuntosQrLimite: true,
        asistenciasInicioAt: true,
        asistenciasFinAt: true,
        createdAt: true,
        afiliacion: {
          include: {
            afiliado: {
              select: {
                id: true,
                codigo: true,
                nombre: true,
                descuentoPorcentaje: true,
                comisionPorcentaje: true,
              },
            },
          },
        },
        usuarios: {
          where: { roles: { some: { rol: { codigo: 'OWNER' } } } },
          take: 1,
          select: {
            usuario: {
              select: { nombre: true, apellido: true, email: true },
            },
          },
        },
        _count: {
          select: {
            usuarios: true,
            sucursales: { where: { tipo: SucursalTipo.tienda } },
            pagosSuscripcion: { where: { estado: 'pagado' } },
          },
        },
      },
    });
    if (!company) throw new NotFoundException('Empresa no encontrada');
    const owner = company.usuarios[0]?.usuario;
    return {
      id: company.id.toString(),
      name: company.nombreComercial,
      legalName: company.razonSocial,
      document: company.ruc ?? company.dni,
      email: company.email,
      phone: company.telefono,
      state: company.estado,
      planCode: company.planCodigo,
      planName: this.plansService.getDefinition(company.planCodigo).name,
      planStatus: this.plansService.getStatus(company, now),
      startsAt: company.planInicioAt.toISOString(),
      endsAt: company.planFinAt?.toISOString() ?? null,
      createdAt: company.createdAt.toISOString(),
      owner: owner
        ? {
            name: [owner.nombre, owner.apellido].filter(Boolean).join(' '),
            email: owner.email,
          }
        : null,
      users: company._count.usuarios,
      branches: company._count.sucursales,
      attendance: this.plansService.mapAttendanceAddon(company),
      affiliateEligible:
        company._count.pagosSuscripcion === 0 &&
        company.afiliacion?.estado !== 'interrumpida',
      monthlyDiscountEligible: company._count.pagosSuscripcion === 0,
      affiliate: company.afiliacion
        ? {
            id: company.afiliacion.afiliado.id.toString(),
            code: company.afiliacion.afiliado.codigo,
            name: company.afiliacion.afiliado.nombre,
            status:
              company.afiliacion.estado === 'activa' &&
              company.planFinAt &&
              company.planFinAt <= now
                ? 'interrumpida'
                : company.afiliacion.estado,
            discountPercent:
              company.afiliacion.afiliado.descuentoPorcentaje.toFixed(2),
            commissionPercent:
              company.afiliacion.afiliado.comisionPorcentaje.toFixed(2),
          }
        : null,
    };
  }

  async findCompanyUsage(
    query: FindPlatformCompaniesQueryDto,
    now = new Date(),
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 12;
    const where = this.buildCompanyWhere(query, now);
    const [companies, total] = await Promise.all([
      this.prisma.empresa.findMany({
        where,
        orderBy: { nombreComercial: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true,
          nombreComercial: true,
          ruc: true,
          dni: true,
          estado: true,
          planCodigo: true,
          planInicioAt: true,
          planFinAt: true,
          asistenciasActiva: true,
          asistenciasTrabajadoresLimite: true,
          asistenciasPuntosQrLimite: true,
          asistenciasInicioAt: true,
          asistenciasFinAt: true,
          limitesAdicionales: true,
        },
      }),
      this.prisma.empresa.count({ where }),
    ]);

    if (companies.length === 0) {
      return {
        data: [],
        meta: this.buildMeta(page, limit, total),
      };
    }

    const companyIds = companies.map((company) => company.id);
    const documentFilters = companies.map((company) => {
      const range = this.plansService.getDocumentRange(company, now);
      return {
        empresaId: company.id,
        createdAt: {
          gte: range.start,
          ...(range.end ? { lt: range.end } : {}),
        },
      };
    });
    const [
      users,
      branches,
      warehouses,
      products,
      variants,
      documents,
      documentQueries,
      storage,
      attendanceEmployees,
      attendanceQrPoints,
    ] = await Promise.all([
      this.prisma.empresaUsuario.groupBy({
        by: ['empresaId'],
        where: {
          empresaId: { in: companyIds },
          estado: EmpresaUsuarioEstado.activo,
          usuario: { estado: UsuarioEstado.activo },
        },
        orderBy: { empresaId: 'asc' },
        _count: { _all: true },
      }),
      this.prisma.sucursal.groupBy({
        by: ['empresaId'],
        where: {
          empresaId: { in: companyIds },
          tipo: SucursalTipo.tienda,
        },
        orderBy: { empresaId: 'asc' },
        _count: { _all: true },
      }),
      this.prisma.sucursal.groupBy({
        by: ['empresaId'],
        where: {
          empresaId: { in: companyIds },
          tipo: SucursalTipo.almacen,
        },
        orderBy: { empresaId: 'asc' },
        _count: { _all: true },
      }),
      this.prisma.producto.groupBy({
        by: ['empresaId'],
        where: { empresaId: { in: companyIds }, deletedAt: null },
        orderBy: { empresaId: 'asc' },
        _count: { _all: true },
      }),
      this.prisma.productoVariante.groupBy({
        by: ['empresaId'],
        where: {
          empresaId: { in: companyIds },
          deletedAt: null,
          producto: { tipo: ProductoTipo.variantes },
        },
        orderBy: { empresaId: 'asc' },
        _count: { _all: true },
      }),
      this.prisma.venta.groupBy({
        by: ['empresaId'],
        where: { OR: documentFilters },
        orderBy: { empresaId: 'asc' },
        _count: { _all: true },
      }),
      this.prisma.consultaDocumento.groupBy({
        by: ['empresaId'],
        where: { OR: documentFilters },
        orderBy: { empresaId: 'asc' },
        _count: { _all: true },
      }),
      this.prisma.productoColorImagen.groupBy({
        by: ['empresaId'],
        where: { empresaId: { in: companyIds } },
        orderBy: { empresaId: 'asc' },
        _sum: { sizeBytes: true },
      }),
      this.prisma.empleado.groupBy({
        by: ['empresaId'],
        where: { empresaId: { in: companyIds }, estado: 'activo' },
        orderBy: { empresaId: 'asc' },
        _count: { _all: true },
      }),
      this.prisma.puntoQrAsistencia.groupBy({
        by: ['empresaId'],
        where: { empresaId: { in: companyIds }, estado: 'activo' },
        orderBy: { empresaId: 'asc' },
        _count: { _all: true },
      }),
    ]);
    const countMap = (
      groups: { empresaId: bigint; _count: { _all: number } }[],
    ) =>
      new Map(
        groups.map((group) => [group.empresaId.toString(), group._count._all]),
      );
    const usageMaps = {
      users: countMap(users),
      branches: countMap(branches),
      warehouses: countMap(warehouses),
      products: countMap(products),
      variants: countMap(variants),
      documents: countMap(documents),
      documentQueries: countMap(documentQueries),
      attendanceEmployees: countMap(attendanceEmployees),
      attendanceQrPoints: countMap(attendanceQrPoints),
      storageBytes: new Map(
        storage.map((group) => [
          group.empresaId.toString(),
          group._sum?.sizeBytes ?? 0,
        ]),
      ),
    };
    const baseLimitsByPlan = new Map(
      await Promise.all(
        [...new Set(companies.map((company) => company.planCodigo))].map(
          async (code) =>
            [
              code,
              await this.plansService.getBaseLimits(this.prisma, code),
            ] as const,
        ),
      ),
    );

    return {
      data: companies.map((company) => {
        const id = company.id.toString();
        const usage = {
          users: usageMaps.users.get(id) ?? 0,
          branches: usageMaps.branches.get(id) ?? 0,
          warehouses: usageMaps.warehouses.get(id) ?? 0,
          products: usageMaps.products.get(id) ?? 0,
          variants: usageMaps.variants.get(id) ?? 0,
          documents: usageMaps.documents.get(id) ?? 0,
          documentQueries: usageMaps.documentQueries.get(id) ?? 0,
          storageBytes: usageMaps.storageBytes.get(id) ?? 0,
          attendanceEmployees: usageMaps.attendanceEmployees.get(id) ?? 0,
          attendanceQrPoints: usageMaps.attendanceQrPoints.get(id) ?? 0,
        };
        const definition = this.plansService.getDefinition(company.planCodigo);
        const baseLimits = baseLimitsByPlan.get(company.planCodigo);
        if (!baseLimits) throw new Error('Limites de plan no encontrados');
        const additionalLimits = this.plansService.mapAdditionalLimits(
          company.limitesAdicionales,
        );
        const effectiveLimits = this.plansService.withAttendanceLimits(
          baseLimits,
          additionalLimits,
          company,
        );

        return {
          id,
          name: company.nombreComercial,
          document: company.ruc ?? company.dni,
          state: company.estado,
          planCode: company.planCodigo,
          planName: definition.name,
          planStatus: this.plansService.getStatus(company, now),
          startsAt: company.planInicioAt.toISOString(),
          endsAt: company.planFinAt?.toISOString() ?? null,
          usage,
          limits: effectiveLimits,
          baseLimits,
          additionalLimits,
          effectiveLimits,
        };
      }),
      meta: this.buildMeta(page, limit, total),
    };
  }

  async findUsers(query: FindPlatformUsersQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 12;
    const search = query.search?.trim();
    const where: Prisma.UsuarioWhereInput = {
      esSuperAdmin: true,
      ...(query.status ? { estado: query.status } : {}),
      ...(search
        ? {
            OR: [
              { nombre: { contains: search, mode: 'insensitive' } },
              { apellido: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [users, total, active] = await Promise.all([
      this.prisma.usuario.findMany({
        where,
        select: platformUserSelect,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.usuario.count({ where }),
      this.prisma.usuario.count({
        where: { AND: [where, { estado: UsuarioEstado.activo }] },
      }),
    ]);

    return {
      data: users.map((user) => this.mapPlatformUser(user)),
      meta: this.buildMeta(page, limit, total),
      summary: { total, active, inactive: total - active },
    };
  }

  async createUser(actor: JwtPayload, dto: CreatePlatformUserDto) {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.usuario.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException('El correo ya pertenece a otro usuario');
    }

    const temporaryPassword = `Nb!${randomBytes(12).toString('base64url')}7a`;

    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.usuario.create({
          data: {
            nombre: dto.nombre.trim(),
            apellido: dto.apellido.trim(),
            email,
            telefono: dto.telefono?.trim() || null,
            passwordHash: await bcrypt.hash(temporaryPassword, 12),
            emailVerificado: true,
            esSuperAdmin: true,
            estado: UsuarioEstado.activo,
          },
          select: platformUserSelect,
        });

        await tx.platformAuditLog.create({
          data: {
            usuarioId: BigInt(actor.sub),
            category: 'admin',
            action: 'platform_admin_created',
            source: 'admin',
            description: `Superadministrador ${created.nombre} ${created.apellido ?? ''} creado`,
            metadata: {
              targetUserId: created.id.toString(),
              email: created.email,
            },
          },
        });

        return created;
      });

      return { user: this.mapPlatformUser(user), temporaryPassword };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('El correo ya pertenece a otro usuario');
      }
      throw error;
    }
  }

  async updateUserStatus(
    actor: JwtPayload,
    id: string,
    dto: UpdatePlatformUserStatusDto,
  ) {
    const targetId = this.parseUserId(id);
    const actorId = BigInt(actor.sub);

    if (targetId === actorId && dto.estado !== UsuarioEstado.activo) {
      throw new BadRequestException('No puedes desactivar tu propia cuenta');
    }

    const current = await this.prisma.usuario.findFirst({
      where: { id: targetId, esSuperAdmin: true },
      select: platformUserSelect,
    });

    if (!current) {
      throw new NotFoundException('Superadministrador no encontrado');
    }

    if (current.estado === dto.estado) {
      return this.mapPlatformUser(current);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const user = await tx.usuario.update({
        where: { id: targetId },
        data: {
          estado: dto.estado,
          refreshTokenVersion: { increment: 1 },
        },
        select: platformUserSelect,
      });

      await tx.refreshToken.updateMany({
        where: { usuarioId: targetId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.platformAuditLog.create({
        data: {
          usuarioId: actorId,
          category: 'admin',
          action: 'platform_admin_status_changed',
          source: 'admin',
          description: `${user.nombre} ${user.apellido ?? ''} fue ${dto.estado === UsuarioEstado.activo ? 'activado' : 'desactivado'}`,
          metadata: {
            targetUserId: user.id.toString(),
            email: user.email,
            fromStatus: current.estado,
            toStatus: dto.estado,
          },
        },
      });

      return user;
    });

    return this.mapPlatformUser(updated);
  }

  findPlanChanges(query: FindPlatformAuditQueryDto, now = new Date()) {
    return this.findAuditLogs({ ...query, category: 'plan' }, now);
  }

  findActivity(query: FindPlatformAuditQueryDto, now = new Date()) {
    return this.findAuditLogs(query, now);
  }

  private async findAuditLogs(query: FindPlatformAuditQueryDto, now: Date) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 15;
    const where = this.buildAuditWhere(query);
    const monthStart = this.buildDashboardPeriod('month', now).start;
    const [logs, total, thisMonth, categoryGroups, sourceGroups] =
      await Promise.all([
        this.prisma.platformAuditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
          include: {
            empresa: {
              select: {
                id: true,
                nombreComercial: true,
                ruc: true,
                dni: true,
              },
            },
            usuario: {
              select: {
                id: true,
                nombre: true,
                apellido: true,
                email: true,
              },
            },
          },
        }),
        this.prisma.platformAuditLog.count({ where }),
        this.prisma.platformAuditLog.count({
          where: { AND: [where, { createdAt: { gte: monthStart } }] },
        }),
        this.prisma.platformAuditLog.groupBy({
          by: ['category'],
          where,
          orderBy: { category: 'asc' },
          _count: { _all: true },
        }),
        this.prisma.platformAuditLog.groupBy({
          by: ['source'],
          where,
          orderBy: { source: 'asc' },
          _count: { _all: true },
        }),
      ]);
    const categoryCounts = new Map(
      categoryGroups.map((group) => [group.category, group._count._all]),
    );
    const sourceCounts = new Map(
      sourceGroups.map((group) => [group.source, group._count._all]),
    );

    return {
      data: logs.map((log) => ({
        id: log.id.toString(),
        category: log.category,
        action: log.action,
        source: log.source,
        description: log.description,
        metadata: log.metadata,
        company: log.empresa
          ? {
              id: log.empresa.id.toString(),
              name: log.empresa.nombreComercial,
              document: log.empresa.ruc ?? log.empresa.dni,
            }
          : null,
        actor: log.usuario
          ? {
              id: log.usuario.id.toString(),
              name: [log.usuario.nombre, log.usuario.apellido]
                .filter(Boolean)
                .join(' '),
              email: log.usuario.email,
            }
          : null,
        createdAt: log.createdAt.toISOString(),
      })),
      meta: this.buildMeta(page, limit, total),
      summary: {
        total,
        thisMonth,
        companyEvents: categoryCounts.get('company') ?? 0,
        planEvents: categoryCounts.get('plan') ?? 0,
        platformAdminEvents: categoryCounts.get('admin') ?? 0,
        subscriptionEvents: categoryCounts.get('subscription') ?? 0,
        affiliateEvents: categoryCounts.get('affiliate') ?? 0,
        registrationEvents: sourceCounts.get('registration') ?? 0,
        historicalEvents: sourceCounts.get('historical') ?? 0,
        cliEvents: sourceCounts.get('cli') ?? 0,
        adminEvents: sourceCounts.get('admin') ?? 0,
      },
    };
  }

  private buildAuditWhere(
    query: FindPlatformAuditQueryDto,
  ): Prisma.PlatformAuditLogWhereInput {
    const search = query.search?.trim();

    return {
      ...(query.category ? { category: query.category } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(search
        ? {
            OR: [
              { description: { contains: search, mode: 'insensitive' } },
              {
                empresa: {
                  nombreComercial: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
              },
              { empresa: { ruc: { contains: search } } },
              { empresa: { dni: { contains: search } } },
              {
                usuario: {
                  email: { contains: search, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };
  }

  private buildCompanyWhere(
    query: FindPlatformCompaniesQueryDto,
    now: Date,
  ): Prisma.EmpresaWhereInput {
    const search = query.search?.trim();
    const filters: Prisma.EmpresaWhereInput[] = [];

    if (search) {
      filters.push({
        OR: [
          { nombreComercial: { contains: search, mode: 'insensitive' } },
          { razonSocial: { contains: search, mode: 'insensitive' } },
          { ruc: { contains: search } },
          { dni: { contains: search } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      });
    }

    if (query.planStatus) {
      filters.push(this.buildPlanStatusWhere(query.planStatus, now));
    }

    return {
      ...(query.plan ? { planCodigo: query.plan } : {}),
      ...(query.state ? { estado: query.state } : {}),
      ...(filters.length ? { AND: filters } : {}),
    };
  }

  private mapPlatformUser(user: {
    id: bigint;
    nombre: string;
    apellido: string | null;
    email: string;
    telefono: string | null;
    estado: UsuarioEstado;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: user.id.toString(),
      name: [user.nombre, user.apellido].filter(Boolean).join(' '),
      firstName: user.nombre,
      lastName: user.apellido,
      email: user.email,
      phone: user.telefono,
      status: user.estado,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    };
  }

  private parseUserId(id: string) {
    try {
      const value = BigInt(id);
      if (value <= 0n) throw new Error();
      return value;
    } catch {
      throw new BadRequestException('Identificador de usuario inválido');
    }
  }

  private buildPlanStatusWhere(
    status: 'trial' | 'active' | 'expired',
    now: Date,
  ): Prisma.EmpresaWhereInput {
    if (status === 'trial') {
      return {
        planCodigo: PlanCodigo.prueba,
        planFinAt: { gt: now },
      };
    }

    if (status === 'active') {
      return {
        planCodigo: { not: PlanCodigo.prueba },
        OR: [{ planFinAt: null }, { planFinAt: { gt: now } }],
      };
    }

    return {
      OR: [
        { planFinAt: { lte: now } },
        { planCodigo: PlanCodigo.prueba, planFinAt: null },
      ],
    };
  }

  private buildMeta(page: number, limit: number, total: number) {
    return {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  private buildDashboardPeriod(filter: PlatformDashboardDateFilter, now: Date) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Lima',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).formatToParts(now);
    const year = Number(parts.find((part) => part.type === 'year')?.value);
    const month = Number(parts.find((part) => part.type === 'month')?.value);
    const day = Number(parts.find((part) => part.type === 'day')?.value);
    const today = new Date(Date.UTC(year, month - 1, day, 5));
    const end = new Date(now.getTime() + 1);

    if (filter === 'year') {
      const start = new Date(Date.UTC(year, 0, 1, 5));
      const buckets = Array.from({ length: month }, (_, index) => {
        const bucketStart = new Date(Date.UTC(year, index, 1, 5));
        return {
          start: bucketStart,
          end: new Date(Date.UTC(year, index + 1, 1, 5)),
          label: new Intl.DateTimeFormat('es-PE', {
            timeZone: 'America/Lima',
            month: 'short',
          })
            .format(bucketStart)
            .replace('.', ''),
        };
      });
      return { start, end, buckets };
    }

    const days =
      filter === 'today'
        ? 1
        : filter === '7days'
          ? 7
          : filter === '14days'
            ? 14
            : filter === '30days'
              ? 30
              : day;
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() - days + 1);
    const buckets: MonthBucket[] = Array.from({ length: days }, (_, index) => {
      const bucketStart = new Date(start);
      bucketStart.setUTCDate(bucketStart.getUTCDate() + index);
      const bucketEnd = new Date(bucketStart);
      bucketEnd.setUTCDate(bucketEnd.getUTCDate() + 1);
      return {
        start: bucketStart,
        end: bucketEnd,
        label:
          days === 1
            ? 'Hoy'
            : new Intl.DateTimeFormat('es-PE', {
                timeZone: 'America/Lima',
                day: '2-digit',
                month: 'short',
              })
                .format(bucketStart)
                .replace('.', ''),
      };
    });
    return { start, end, buckets };
  }
}
