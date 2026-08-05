import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  EmpresaEstado,
  EmpresaUsuarioEstado,
  NotificacionAudiencia,
  NotificacionCategoria,
  NotificacionNivel,
  NotificacionOrigen,
  Prisma,
  UsuarioEstado,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import {
  FindManualNotificationsQueryDto,
  FindNotificationUsersQueryDto,
  FindNotificationsQueryDto,
  PublishNotificationDto,
} from './dto/notifications.dto';

type AutomaticNotification = {
  eventKey: string;
  category: NotificacionCategoria;
  level: NotificacionNivel;
  title: string;
  message: string;
  link?: string;
  companyId?: bigint;
  recipientIds: bigint[];
};

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async findMine(user: JwtPayload, query: FindNotificationsQueryDto) {
    const userId = this.parseId(user.sub, 'usuario');
    const now = new Date();
    const cursor = query.cursor
      ? this.parseId(query.cursor, 'cursor')
      : undefined;
    const activeWhere: Prisma.NotificacionDestinatarioWhereInput = {
      usuarioId: userId,
      notificacion: {
        archivedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    };
    const [rows, unreadCount, total] = await Promise.all([
      this.prisma.notificacionDestinatario.findMany({
        where: {
          ...activeWhere,
          ...(cursor ? { id: { lt: cursor } } : {}),
        },
        include: { notificacion: true },
        orderBy: { id: 'desc' },
        skip: cursor ? 0 : (query.page - 1) * query.limit,
        take: query.limit + 1,
      }),
      this.prisma.notificacionDestinatario.count({
        where: { ...activeWhere, leidoAt: null },
      }),
      this.prisma.notificacionDestinatario.count({ where: activeWhere }),
    ]);
    const hasMore = rows.length > query.limit;
    const visible = hasMore ? rows.slice(0, query.limit) : rows;

    return {
      data: visible.map((row) => this.mapRecipient(row)),
      unreadCount,
      nextCursor: hasMore ? visible.at(-1)?.id.toString() : null,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  async markRead(user: JwtPayload, notificationId: string) {
    const result = await this.prisma.notificacionDestinatario.updateMany({
      where: {
        usuarioId: this.parseId(user.sub, 'usuario'),
        notificacionId: this.parseId(notificationId, 'notificacion'),
      },
      data: { leidoAt: new Date() },
    });
    if (!result.count)
      throw new NotFoundException('Notificacion no encontrada');
    return { success: true };
  }

  async markAllRead(user: JwtPayload) {
    const now = new Date();
    const result = await this.prisma.notificacionDestinatario.updateMany({
      where: {
        usuarioId: this.parseId(user.sub, 'usuario'),
        leidoAt: null,
        notificacion: {
          archivedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      },
      data: { leidoAt: now },
    });
    return { updated: result.count };
  }

  async publish(actor: JwtPayload, dto: PublishNotificationDto) {
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (expiresAt && expiresAt <= new Date()) {
      throw new BadRequestException('La fecha de vencimiento debe ser futura');
    }
    const recipients = await this.resolveManualRecipients(dto);
    if (!recipients.length) {
      throw new BadRequestException('La audiencia no tiene usuarios activos');
    }
    const audienceData = this.getAudienceData(dto);
    const notification = await this.prisma.$transaction(async (tx) => {
      const created = await tx.notificacion.create({
        data: {
          creadoPorId: this.parseId(actor.sub, 'usuario'),
          categoria: NotificacionCategoria.aviso,
          nivel: dto.level,
          origen: NotificacionOrigen.manual,
          audiencia: dto.audience,
          audienciaDatos: audienceData,
          titulo: dto.title.trim(),
          mensaje: dto.message.trim(),
          expiresAt,
        },
      });
      await tx.notificacionDestinatario.createMany({
        data: recipients.map((usuarioId) => ({
          notificacionId: created.id,
          usuarioId,
        })),
        skipDuplicates: true,
      });
      return created;
    });
    return { id: notification.id.toString(), recipients: recipients.length };
  }

  async findManual(query: FindManualNotificationsQueryDto) {
    const page = query.page;
    const limit = query.limit;
    const search = query.search?.trim();
    const where: Prisma.NotificacionWhereInput = {
      origen: NotificacionOrigen.manual,
      ...(search
        ? {
            OR: [
              { titulo: { contains: search, mode: 'insensitive' } },
              { mensaje: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.notificacion.findMany({
        where,
        include: {
          creadoPor: { select: { id: true, nombre: true, apellido: true } },
          _count: { select: { destinatarios: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notificacion.count({ where }),
    ]);
    return {
      data: rows.map((item) => ({
        id: item.id.toString(),
        title: item.titulo,
        message: item.mensaje,
        level: item.nivel,
        audience: item.audiencia,
        audienceData: item.audienciaDatos,
        recipients: item._count.destinatarios,
        expiresAt: item.expiresAt?.toISOString() ?? null,
        archivedAt: item.archivedAt?.toISOString() ?? null,
        createdAt: item.createdAt.toISOString(),
        createdBy: item.creadoPor
          ? {
              id: item.creadoPor.id.toString(),
              name: [item.creadoPor.nombre, item.creadoPor.apellido]
                .filter(Boolean)
                .join(' '),
            }
          : null,
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async archive(id: string) {
    const notificationId = this.parseId(id, 'notificacion');
    const current = await this.prisma.notificacion.findFirst({
      where: { id: notificationId, origen: NotificacionOrigen.manual },
    });
    if (!current) throw new NotFoundException('Aviso no encontrado');
    if (!current.archivedAt) {
      await this.prisma.notificacion.update({
        where: { id: notificationId },
        data: { archivedAt: new Date() },
      });
    }
    return { success: true };
  }

  async findCompanyUsers(query: FindNotificationUsersQueryDto) {
    const companyId = this.parseId(query.companyId, 'empresa');
    const search = query.search?.trim();
    const where: Prisma.EmpresaUsuarioWhereInput = {
      empresaId: companyId,
      estado: EmpresaUsuarioEstado.activo,
      usuario: {
        estado: UsuarioEstado.activo,
        ...(search
          ? {
              OR: [
                { nombre: { contains: search, mode: 'insensitive' } },
                { apellido: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.empresaUsuario.findMany({
        where,
        select: {
          usuario: {
            select: { id: true, nombre: true, apellido: true, email: true },
          },
        },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: [{ usuario: { nombre: 'asc' } }, { usuarioId: 'asc' }],
      }),
      this.prisma.empresaUsuario.count({ where }),
    ]);
    return {
      data: rows.map(({ usuario }) => ({
        id: usuario.id.toString(),
        name: [usuario.nombre, usuario.apellido].filter(Boolean).join(' '),
        email: usuario.email,
      })),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  async createAutomatic(input: AutomaticNotification) {
    const recipientIds = [...new Set(input.recipientIds.map(String))].map(
      BigInt,
    );
    if (!recipientIds.length) return;
    try {
      await this.prisma.$transaction(async (tx) => {
        const notification = await tx.notificacion.create({
          data: {
            empresaId: input.companyId,
            categoria: input.category,
            nivel: input.level,
            origen: NotificacionOrigen.automatico,
            audiencia: NotificacionAudiencia.automatico,
            titulo: input.title,
            mensaje: input.message,
            enlace: input.link,
            claveEvento: input.eventKey,
          },
        });
        await tx.notificacionDestinatario.createMany({
          data: recipientIds.map((usuarioId) => ({
            notificacionId: notification.id,
            usuarioId,
          })),
          skipDuplicates: true,
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return;
      }
      throw error;
    }
  }

  getOwnerIds(companyId: bigint) {
    return this.getCompanyRecipientIds(companyId, [], undefined, true);
  }

  getOperationalRecipientIds(
    companyId: bigint,
    moduleKeys: string[],
    creatorId?: bigint | null,
  ) {
    return this.getCompanyRecipientIds(companyId, moduleKeys, creatorId, true);
  }

  async getSuperAdminIds() {
    const users = await this.prisma.usuario.findMany({
      where: { esSuperAdmin: true, estado: UsuarioEstado.activo },
      select: { id: true },
    });
    return users.map(({ id }) => id);
  }

  private async getCompanyRecipientIds(
    companyId: bigint,
    moduleKeys: string[],
    creatorId?: bigint | null,
    includeOwners = false,
  ) {
    const rows = await this.prisma.empresaUsuario.findMany({
      where: {
        empresaId: companyId,
        estado: EmpresaUsuarioEstado.activo,
        usuario: { estado: UsuarioEstado.activo },
        OR: [
          ...(includeOwners
            ? [{ roles: { some: { rol: { codigo: 'OWNER' } } } }]
            : []),
          ...(moduleKeys.length
            ? [{ modulos: { some: { moduleKey: { in: moduleKeys } } } }]
            : []),
          ...(creatorId ? [{ usuarioId: creatorId }] : []),
        ],
      },
      select: { usuarioId: true },
    });
    return rows.map(({ usuarioId }) => usuarioId);
  }

  private async resolveManualRecipients(dto: PublishNotificationDto) {
    const base: Prisma.EmpresaUsuarioWhereInput = {
      estado: EmpresaUsuarioEstado.activo,
      usuario: { estado: UsuarioEstado.activo },
      empresa: { estado: EmpresaEstado.activa },
    };
    if (dto.audience === 'planes') {
      if (!dto.planCodes?.length)
        throw new BadRequestException('Selecciona al menos un plan');
      base.empresa = {
        estado: EmpresaEstado.activa,
        planCodigo: { in: dto.planCodes },
      };
    } else if (dto.audience === 'empresa') {
      if (!dto.companyId)
        throw new BadRequestException('Selecciona una empresa');
      base.empresaId = this.parseId(dto.companyId, 'empresa');
    } else if (dto.audience === 'usuario') {
      if (!dto.userId) throw new BadRequestException('Selecciona un usuario');
      base.usuarioId = this.parseId(dto.userId, 'usuario');
    }
    const rows = await this.prisma.empresaUsuario.findMany({
      where: base,
      select: { usuarioId: true },
    });
    return [...new Set(rows.map(({ usuarioId }) => usuarioId.toString()))].map(
      BigInt,
    );
  }

  private getAudienceData(dto: PublishNotificationDto): Prisma.InputJsonValue {
    if (dto.audience === 'planes') return { planCodes: dto.planCodes ?? [] };
    if (dto.audience === 'empresa') return { companyId: dto.companyId ?? '' };
    if (dto.audience === 'usuario') return { userId: dto.userId ?? '' };
    return {};
  }

  private mapRecipient(
    row: Prisma.NotificacionDestinatarioGetPayload<{
      include: { notificacion: true };
    }>,
  ) {
    const item = row.notificacion;
    return {
      id: item.id.toString(),
      category: item.categoria,
      level: item.nivel,
      title: item.titulo,
      message: item.mensaje,
      link: item.enlace,
      readAt: row.leidoAt?.toISOString() ?? null,
      createdAt: item.createdAt.toISOString(),
    };
  }

  private parseId(value: string, label: string) {
    try {
      const id = BigInt(value);
      if (id <= 0n) throw new Error();
      return id;
    } catch {
      throw new BadRequestException(`${label} no valido`);
    }
  }
}
