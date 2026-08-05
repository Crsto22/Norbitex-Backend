import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  EmpresaEstado,
  EmpresaUsuarioEstado,
  PlanCodigo,
  Prisma,
  UsuarioEstado,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { PlansService } from '../plans/plans.service';
import { ChangeMyPasswordDto } from './dto/change-my-password.dto';
import { CreateCompanyDto } from './dto/create-company.dto';
import { getDefaultCompanyCatalogs } from './default-company-catalogs';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { ValidateResetTokenDto } from './dto/validate-reset-token.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { JwtPayload } from './types/jwt-payload.type';
import { LoginSecurityService } from './login-security.service';
import { TurnstileService } from './turnstile.service';

type AuthCompany = {
  empresaId: bigint;
  nombreComercial: string;
  logoUrl: string | null;
  usuarioId: bigint;
  nombre: string;
  apellido: string | null;
  email: string;
  telefono: string | null;
  empresaUsuarioId: bigint;
  refreshTokenVersion?: number;
  planCodigo: PlanCodigo;
  planInicioAt: Date;
  planFinAt: Date | null;
  sucursalId?: bigint | null;
  visibilidadOperaciones?: 'propias' | 'todas';
};

type AuthUser = {
  id: bigint;
  nombre: string;
  apellido: string | null;
  email: string;
  telefono: string | null;
  refreshTokenVersion: number;
};

type OnboardingUser = {
  usuarioId: bigint;
  email: string;
};

const defaultPaymentMethods = [
  {
    nombre: 'Efectivo',
    nombreKey: 'efectivo',
    codigo: 'efectivo',
    descripcion: 'Pago en efectivo',
    esSistema: true,
    permiteVuelto: true,
    orden: 1,
  },
  {
    nombre: 'Yape',
    nombreKey: 'yape',
    codigo: 'yape',
    descripcion: 'Pago por Yape',
    esSistema: true,
    permiteVuelto: false,
    orden: 2,
  },
  {
    nombre: 'Plin',
    nombreKey: 'plin',
    codigo: 'plin',
    descripcion: 'Pago por Plin',
    esSistema: true,
    permiteVuelto: false,
    orden: 3,
  },
  {
    nombre: 'Transferencia',
    nombreKey: 'transferencia',
    codigo: 'transferencia',
    descripcion: 'Pago por transferencia bancaria',
    esSistema: true,
    permiteVuelto: false,
    orden: 4,
  },
] as const;

@Injectable()
export class AuthService {
  private readonly verificationCodeTtlMinutes = 10;
  private readonly maxVerificationAttempts = 5;
  private readonly refreshTokenTtlDays = 7;
  private readonly resetTokenTtlMinutes = 30;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
    private readonly plansService: PlansService,
    private readonly turnstileService: TurnstileService,
    private readonly loginSecurityService: LoginSecurityService,
  ) {}

  async register(dto: RegisterDto) {
    await this.turnstileService.verify(dto.turnstileToken, 'register');

    if (dto.password !== dto.confirmarPassword) {
      throw new BadRequestException('Las contrasenas no coinciden');
    }

    const email = dto.email.toLowerCase();
    await this.ensureEmailIsAvailable(this.prisma, email);

    const code = this.generateVerificationCode();
    const [passwordHash, codigoHash] = await Promise.all([
      bcrypt.hash(dto.password, 12),
      bcrypt.hash(code, 12),
    ]);

    const expiresAt = new Date();
    expiresAt.setMinutes(
      expiresAt.getMinutes() + this.verificationCodeTtlMinutes,
    );

    await this.prisma.registroPendiente.upsert({
      where: { email },
      create: {
        nombre: dto.nombre,
        apellido: dto.apellido,
        email,
        passwordHash,
        codigoHash,
        expiresAt,
      },
      update: {
        nombre: dto.nombre,
        apellido: dto.apellido,
        passwordHash,
        codigoHash,
        expiresAt,
        intentos: 0,
        verifiedAt: null,
      },
    });

    await this.mailService.sendVerificationCode(email, code);

    return {
      message: 'Codigo de verificacion enviado',
      email,
      expiresInMinutes: this.verificationCodeTtlMinutes,
    };
  }

  async verifyEmail(dto: VerifyEmailDto) {
    const email = dto.email.toLowerCase();
    const pending = await this.prisma.registroPendiente.findUnique({
      where: { email },
    });

    if (!pending || pending.verifiedAt) {
      throw new BadRequestException('Registro pendiente no encontrado');
    }

    if (pending.expiresAt < new Date()) {
      throw new BadRequestException('El codigo expiro');
    }

    if (pending.intentos >= this.maxVerificationAttempts) {
      throw new BadRequestException('Se alcanzo el limite de intentos');
    }

    const codeIsValid = await bcrypt.compare(dto.codigo, pending.codigoHash);

    if (!codeIsValid) {
      await this.prisma.registroPendiente.update({
        where: { id: pending.id },
        data: { intentos: { increment: 1 } },
      });
      throw new BadRequestException('Codigo invalido');
    }

    const usuario = await this.prisma.$transaction(async (tx) => {
      await this.ensureEmailIsAvailable(tx, email);

      const createdUser = await tx.usuario.create({
        data: {
          nombre: pending.nombre,
          apellido: pending.apellido,
          email,
          passwordHash: pending.passwordHash,
          emailVerificado: true,
        },
      });

      await tx.registroPendiente.update({
        where: { id: pending.id },
        data: { verifiedAt: new Date() },
      });

      return createdUser;
    });

    return {
      message: 'Correo verificado correctamente',
      onboardingToken: this.buildOnboardingToken({
        usuarioId: usuario.id,
        email: usuario.email,
      }),
      usuario: {
        id: usuario.id.toString(),
        email: usuario.email,
      },
    };
  }

  async createCompany(user: JwtPayload, dto: CreateCompanyDto) {
    if (user.empresaId) {
      throw new BadRequestException('El usuario ya tiene una empresa activa');
    }

    if (user.setup !== 'company') {
      throw new UnauthorizedException(
        'Completa el inicio de sesion nuevamente',
      );
    }

    const usuarioId = BigInt(user.sub);
    const ruc = dto.ruc?.trim() || undefined;
    const dni = dto.dni?.trim() || undefined;
    const planInicioAt = new Date();
    const planFinAt = new Date(
      planInicioAt.getTime() + 7 * 24 * 60 * 60 * 1000,
    );

    if (Boolean(ruc) === Boolean(dni)) {
      throw new BadRequestException('Ingresa RUC o DNI, solo uno de ellos');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const usuario = await tx.usuario.findFirst({
        where: {
          id: usuarioId,
          estado: UsuarioEstado.activo,
          emailVerificado: true,
        },
        select: {
          id: true,
          nombre: true,
          apellido: true,
          email: true,
          telefono: true,
          refreshTokenVersion: true,
          empresas: { select: { id: true }, take: 1 },
        },
      });

      if (!usuario) {
        throw new UnauthorizedException('Usuario no valido');
      }

      if (usuario.empresas.length > 0) {
        throw new ConflictException(
          'El usuario ya esta asociado a una empresa',
        );
      }

      if (ruc) {
        await this.ensureRucIsAvailable(tx, ruc);
      }

      if (dni) {
        await this.ensureDniIsAvailable(tx, dni);
      }

      const ownerRole = await tx.rol.findUnique({ where: { codigo: 'OWNER' } });

      if (!ownerRole) {
        throw new ConflictException('El rol OWNER no existe');
      }

      const empresa = await tx.empresa.create({
        data: {
          nombreComercial: dto.nombreComercial,
          razonSocial: ruc ? (dto.razonSocial ?? null) : null,
          ruc: ruc ?? null,
          dni: dni ?? null,
          telefono: dto.telefonoEmpresa ?? null,
          email: dto.emailEmpresa ?? null,
          direccion: dto.direccion ?? null,
          comoConocio: dto.comoConocio,
          comoConocioOtro: dto.comoConocioOtro ?? null,
          planInicioAt,
          planFinAt,
        },
      });

      const empresaUsuario = await tx.empresaUsuario.create({
        data: {
          empresaId: empresa.id,
          usuarioId: usuario.id,
          roles: {
            create: {
              rolId: ownerRole.id,
            },
          },
        },
      });

      await tx.serieComprobante.createMany({
        data: [
          {
            empresaId: empresa.id,
            tipoComprobante: 'nota_venta',
            serie: 'NV01',
            esPrincipal: true,
            aplicaTodasSucursales: true,
            numeroActual: 0,
          },
          {
            empresaId: empresa.id,
            tipoComprobante: 'factura',
            serie: 'F001',
            esPrincipal: true,
            aplicaTodasSucursales: true,
            numeroActual: 0,
          },
          {
            empresaId: empresa.id,
            tipoComprobante: 'boleta',
            serie: 'B001',
            esPrincipal: true,
            aplicaTodasSucursales: true,
            numeroActual: 0,
          },
          {
            empresaId: empresa.id,
            tipoComprobante: 'guia_remision',
            serie: 'T001',
            esPrincipal: true,
            aplicaTodasSucursales: true,
            numeroActual: 0,
          },
          {
            empresaId: empresa.id,
            tipoComprobante: 'nota_credito_factura',
            serie: 'FC01',
            esPrincipal: true,
            aplicaTodasSucursales: true,
            numeroActual: 0,
          },
          {
            empresaId: empresa.id,
            tipoComprobante: 'nota_credito_boleta',
            serie: 'BC01',
            esPrincipal: true,
            aplicaTodasSucursales: true,
            numeroActual: 0,
          },
        ],
      });

      await tx.metodoPago.createMany({
        data: defaultPaymentMethods.map((method) => ({
          empresaId: empresa.id,
          ...method,
        })),
      });

      const catalogs = getDefaultCompanyCatalogs(dto.catalogProfile);

      if (catalogs.colors.length) {
        await tx.color.createMany({
          data: catalogs.colors.map((color) => ({
            empresaId: empresa.id,
            ...color,
          })),
          skipDuplicates: true,
        });
      }

      if (catalogs.sizes.length) {
        await tx.talla.createMany({
          data: catalogs.sizes.map((size) => ({
            empresaId: empresa.id,
            ...size,
          })),
          skipDuplicates: true,
        });
      }

      await tx.platformAuditLog.create({
        data: {
          empresaId: empresa.id,
          usuarioId: usuario.id,
          category: 'company',
          action: 'company_created',
          source: 'registration',
          description: 'Empresa registrada con plan Prueba',
          metadata: { planCode: empresa.planCodigo },
        },
      });

      return {
        empresaId: empresa.id,
        nombreComercial: empresa.nombreComercial,
        logoUrl: empresa.logoUrl ?? null,
        usuarioId: usuario.id,
        nombre: usuario.nombre,
        apellido: usuario.apellido,
        email: usuario.email,
        telefono: usuario.telefono,
        empresaUsuarioId: empresaUsuario.id,
        refreshTokenVersion: usuario.refreshTokenVersion + 1,
        planCodigo: empresa.planCodigo,
        planInicioAt: empresa.planInicioAt,
        planFinAt: empresa.planFinAt,
      };
    });

    await this.prisma.usuario.update({
      where: { id: result.usuarioId },
      data: { refreshTokenVersion: result.refreshTokenVersion },
    });

    return this.buildAuthSession(
      result,
      ['OWNER'],
      this.getSessionModuleKeys(result, ['OWNER'], []),
      result.refreshTokenVersion,
    );
  }

  async login(dto: LoginDto, ip = '') {
    const email = dto.email.toLowerCase();
    await this.loginSecurityService.enforce(email, ip, dto.turnstileToken);

    const usuario = await this.prisma.usuario.findFirst({
      where: {
        email,
        estado: UsuarioEstado.activo,
        emailVerificado: true,
      },
      include: {
        _count: {
          select: { empresas: true },
        },
        empresas: {
          where: {
            estado: EmpresaUsuarioEstado.activo,
            empresa: {
              estado: EmpresaEstado.activa,
            },
          },
          include: {
            empresa: true,
            roles: {
              include: {
                rol: true,
              },
            },
            modulos: true,
          },
          orderBy: {
            empresaId: 'asc',
          },
          take: 1,
        },
      },
    });

    const empresaUsuario = usuario?.empresas[0];

    if (
      !usuario ||
      !(await bcrypt.compare(dto.password, usuario.passwordHash))
    ) {
      await this.loginSecurityService.recordFailure(email, ip);
      throw new UnauthorizedException('Credenciales invalidas');
    }

    await this.loginSecurityService.clear(email, ip);

    if (!usuario.esSuperAdmin && !empresaUsuario) {
      if (usuario._count.empresas > 0) {
        throw new UnauthorizedException('No tienes una empresa activa');
      }

      return {
        setupRequired: 'company' as const,
        onboardingToken: this.buildOnboardingToken({
          usuarioId: usuario.id,
          email: usuario.email,
        }),
        usuario: {
          id: usuario.id.toString(),
          nombre: usuario.nombre,
          apellido: usuario.apellido,
          email: usuario.email,
        },
        refreshToken: undefined,
      };
    }

    const refreshTokenVersion = usuario.refreshTokenVersion + 1;

    await this.prisma.usuario.update({
      where: { id: usuario.id },
      data: { refreshTokenVersion },
    });

    if (usuario.esSuperAdmin) {
      return this.buildPlatformAdminSession(
        { ...usuario, refreshTokenVersion },
        refreshTokenVersion,
      );
    }

    if (!empresaUsuario) {
      throw new UnauthorizedException('Credenciales invalidas');
    }

    return this.buildAuthSession(
      {
        empresaId: empresaUsuario.empresa.id,
        nombreComercial: empresaUsuario.empresa.nombreComercial,
        logoUrl: empresaUsuario.empresa.logoUrl ?? null,
        usuarioId: usuario.id,
        nombre: usuario.nombre,
        apellido: usuario.apellido,
        email: usuario.email,
        telefono: usuario.telefono,
        empresaUsuarioId: empresaUsuario.id,
        planCodigo: empresaUsuario.empresa.planCodigo,
        planInicioAt: empresaUsuario.empresa.planInicioAt,
        planFinAt: empresaUsuario.empresa.planFinAt,
        sucursalId: empresaUsuario.sucursalId,
        visibilidadOperaciones: empresaUsuario.visibilidadOperaciones,
      },
      empresaUsuario.roles.map(({ rol }) => rol.codigo),
      this.getSessionModuleKeys(
        empresaUsuario.empresa,
        empresaUsuario.roles.map(({ rol }) => rol.codigo),
        empresaUsuario.modulos,
      ),
      refreshTokenVersion,
    );
  }

  async me(user: JwtPayload) {
    if (!user.empresaId) {
      const current = await this.findPlatformAdmin(user);

      return {
        id: current.id.toString(),
        empresaUsuarioId: null,
        nombre: current.nombre,
        apellido: current.apellido,
        email: current.email,
        telefono: current.telefono,
        roles: ['SUPERADMIN'],
        moduleKeys: [],
      };
    }

    const current = await this.findActiveCompanyUser(user);
    const roles = current.roles.map(({ rol }) => rol.codigo);

    return {
      id: current.usuario.id.toString(),
      empresaUsuarioId: current.id.toString(),
      nombre: current.usuario.nombre,
      apellido: current.usuario.apellido,
      email: current.usuario.email,
      telefono: current.usuario.telefono,
      roles,
      moduleKeys:
        user.moduleKeys ??
        this.getSessionModuleKeys(current.empresa, roles, current.modulos),
      sucursalId: roles.includes('OWNER')
        ? null
        : (current.sucursalId?.toString() ?? null),
      sucursal:
        roles.includes('OWNER') || !current.sucursal
          ? null
          : {
              id: current.sucursal.id.toString(),
              nombre: current.sucursal.nombre,
              estado: current.sucursal.estado,
              tipo: current.sucursal.tipo,
            },
      sucursalTipo: roles.includes('OWNER')
        ? null
        : (current.sucursal?.tipo ?? null),
      visibilidadOperaciones: roles.includes('OWNER')
        ? 'todas'
        : current.visibilidadOperaciones,
    };
  }

  async updateMe(user: JwtPayload, dto: UpdateMeDto) {
    const nombre = dto.nombre.trim();

    if (!nombre) {
      throw new BadRequestException('El nombre es obligatorio');
    }

    const companyUser = user.empresaId
      ? await this.findActiveCompanyUser(user)
      : null;
    const currentUser =
      companyUser?.usuario ?? (await this.findPlatformAdmin(user));
    const updatedUser = await this.prisma.usuario.update({
      where: { id: currentUser.id },
      data: {
        nombre,
        apellido: dto.apellido?.trim() || null,
        telefono: dto.telefono?.trim() || null,
        refreshTokenVersion: { increment: 1 },
      },
    });

    return companyUser
      ? this.buildAuthSessionFromCompanyUser(companyUser, updatedUser)
      : this.buildPlatformAdminSession(
          updatedUser,
          updatedUser.refreshTokenVersion,
        );
  }

  async changeMyPassword(user: JwtPayload, dto: ChangeMyPasswordDto) {
    if (dto.password !== dto.confirmarPassword) {
      throw new BadRequestException('Las contrasenas no coinciden');
    }

    const companyUser = user.empresaId
      ? await this.findActiveCompanyUser(user)
      : null;
    const currentUser =
      companyUser?.usuario ?? (await this.findPlatformAdmin(user));
    const isCurrentPasswordValid = await bcrypt.compare(
      dto.currentPassword,
      currentUser.passwordHash,
    );

    if (!isCurrentPasswordValid) {
      throw new UnauthorizedException('La contrasena actual no es correcta');
    }

    const updatedUser = await this.prisma.usuario.update({
      where: { id: currentUser.id },
      data: {
        passwordHash: await bcrypt.hash(dto.password, 12),
        refreshTokenVersion: { increment: 1 },
      },
    });

    await this.prisma.refreshToken.updateMany({
      where: { usuarioId: currentUser.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return companyUser
      ? this.buildAuthSessionFromCompanyUser(companyUser, updatedUser)
      : this.buildPlatformAdminSession(
          updatedUser,
          updatedUser.refreshTokenVersion,
        );
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    await this.turnstileService.verify(dto.turnstileToken, 'forgot_password');

    const email = dto.email.toLowerCase();
    const usuario = await this.prisma.usuario.findFirst({
      where: {
        email,
        estado: UsuarioEstado.activo,
        emailVerificado: true,
      },
      select: { id: true, email: true },
    });

    if (!usuario) {
      throw new NotFoundException('Este correo no esta registrado en Nobitex.');
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + this.resetTokenTtlMinutes);

    await this.prisma.passwordResetToken.create({
      data: {
        usuarioId: usuario.id,
        tokenHash: this.hashToken(token),
        expiresAt,
      },
    });

    await this.mailService.sendPasswordResetToken(usuario.email, token);

    return {
      message: 'Enviamos un enlace para restablecer tu contrasena.',
      expiresInMinutes: this.resetTokenTtlMinutes,
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    if (dto.password !== dto.confirmarPassword) {
      throw new BadRequestException('Las contrasenas no coinciden');
    }

    const now = new Date();
    const resetToken = await this.findUsableResetToken(dto.token, now);
    const passwordHash = await bcrypt.hash(dto.password, 12);

    await this.prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.updateMany({
        where: {
          id: resetToken.id,
          usedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });

      await tx.usuario.update({
        where: { id: resetToken.usuarioId },
        data: {
          passwordHash,
          refreshTokenVersion: { increment: 1 },
        },
      });

      await tx.refreshToken.updateMany({
        where: {
          usuarioId: resetToken.usuarioId,
          revokedAt: null,
        },
        data: { revokedAt: now },
      });
    });

    return { message: 'Contrasena actualizada correctamente' };
  }

  async validateResetToken(dto: ValidateResetTokenDto) {
    await this.findUsableResetToken(dto.token);

    return { message: 'Enlace valido' };
  }

  async refresh(refreshToken?: string) {
    if (!refreshToken) {
      throw new UnauthorizedException('Sesion no valida');
    }

    const tokenHash = this.hashToken(refreshToken);
    const storedToken = await this.prisma.refreshToken.findFirst({
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      include: {
        usuario: true,
        empresa: true,
      },
    });

    if (
      !storedToken ||
      storedToken.usuario.estado !== UsuarioEstado.activo ||
      (!storedToken.empresa && !storedToken.usuario.esSuperAdmin)
    ) {
      throw new UnauthorizedException('Sesion no valida');
    }

    if (
      storedToken.refreshTokenVersion !==
      storedToken.usuario.refreshTokenVersion
    ) {
      await this.prisma.refreshToken.update({
        where: { id: storedToken.id },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Sesion no valida');
    }

    const empresaUsuario = storedToken.empresa
      ? await this.prisma.empresaUsuario.findFirst({
          where: {
            usuarioId: storedToken.usuarioId,
            empresaId: storedToken.empresa.id,
            estado: EmpresaUsuarioEstado.activo,
            empresa: { estado: EmpresaEstado.activa },
          },
          include: {
            empresa: true,
            roles: { include: { rol: true } },
            modulos: true,
          },
        })
      : null;

    if (storedToken.empresa && !empresaUsuario) {
      throw new UnauthorizedException('Sesion no valida');
    }

    const refreshTokenVersion = storedToken.usuario.refreshTokenVersion + 1;

    await this.prisma.$transaction([
      this.prisma.refreshToken.update({
        where: { id: storedToken.id },
        data: { revokedAt: new Date() },
      }),
      this.prisma.usuario.update({
        where: { id: storedToken.usuario.id },
        data: { refreshTokenVersion },
      }),
    ]);

    if (!empresaUsuario) {
      return this.buildPlatformAdminSession(
        { ...storedToken.usuario, refreshTokenVersion },
        refreshTokenVersion,
      );
    }

    return this.buildAuthSession(
      {
        empresaId: empresaUsuario.empresa.id,
        nombreComercial: empresaUsuario.empresa.nombreComercial,
        logoUrl: empresaUsuario.empresa.logoUrl ?? null,
        usuarioId: storedToken.usuario.id,
        nombre: storedToken.usuario.nombre,
        apellido: storedToken.usuario.apellido,
        email: storedToken.usuario.email,
        telefono: storedToken.usuario.telefono,
        empresaUsuarioId: empresaUsuario.id,
        planCodigo: empresaUsuario.empresa.planCodigo,
        planInicioAt: empresaUsuario.empresa.planInicioAt,
        planFinAt: empresaUsuario.empresa.planFinAt,
        sucursalId: empresaUsuario.sucursalId,
        visibilidadOperaciones: empresaUsuario.visibilidadOperaciones,
      },
      empresaUsuario.roles.map(({ rol }) => rol.codigo),
      this.getSessionModuleKeys(
        empresaUsuario.empresa,
        empresaUsuario.roles.map(({ rol }) => rol.codigo),
        empresaUsuario.modulos,
      ),
      refreshTokenVersion,
    );
  }

  async logout(refreshToken?: string) {
    if (!refreshToken) {
      return;
    }

    const tokenHash = this.hashToken(refreshToken);
    const storedToken = await this.prisma.refreshToken.findFirst({
      where: { tokenHash, revokedAt: null },
      select: { usuarioId: true },
    });

    if (!storedToken) {
      return;
    }

    await this.prisma.$transaction([
      this.prisma.refreshToken.updateMany({
        where: {
          usuarioId: storedToken.usuarioId,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      }),
      this.prisma.usuario.update({
        where: { id: storedToken.usuarioId },
        data: { refreshTokenVersion: { increment: 1 } },
      }),
    ]);
  }

  private async ensureEmailIsAvailable(
    tx: Prisma.TransactionClient | PrismaService,
    email: string,
  ) {
    const usuario = await tx.usuario.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true },
    });

    if (usuario) {
      throw new ConflictException(
        'El email ya esta registrado. Inicia sesion para continuar',
      );
    }
  }

  private async ensureRucIsAvailable(
    tx: Prisma.TransactionClient,
    ruc: string,
  ) {
    const empresa = await tx.empresa.findUnique({
      where: { ruc },
      select: { id: true },
    });

    if (empresa) {
      throw new ConflictException('El RUC ya esta registrado');
    }
  }

  private async ensureDniIsAvailable(
    tx: Prisma.TransactionClient,
    dni: string,
  ) {
    const empresa = await tx.empresa.findUnique({
      where: { dni },
      select: { id: true },
    });

    if (empresa) {
      throw new ConflictException('El DNI ya esta registrado');
    }
  }

  private generateVerificationCode() {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  private async findUsableResetToken(token: string, now = new Date()) {
    const resetToken = await this.prisma.passwordResetToken.findFirst({
      where: {
        tokenHash: this.hashToken(token),
      },
      include: {
        usuario: true,
      },
    });

    if (!resetToken || resetToken.usuario.estado !== UsuarioEstado.activo) {
      throw new BadRequestException(
        'El enlace de restablecimiento no es valido.',
      );
    }

    if (resetToken.usedAt || resetToken.expiresAt <= now) {
      throw new BadRequestException(
        'El enlace de restablecimiento expiro o ya fue usado.',
      );
    }

    return resetToken;
  }

  private buildOnboardingToken(user: OnboardingUser) {
    return this.jwtService.sign({
      sub: user.usuarioId.toString(),
      email: user.email,
      roles: [],
      setup: 'company',
    });
  }

  private async buildAuthSession(
    user: AuthCompany,
    roles: string[],
    moduleKeys: string[],
    refreshTokenVersion: number,
  ) {
    const refreshToken = await this.createRefreshToken(
      user,
      refreshTokenVersion,
    );

    return {
      ...this.buildAccessResponse(user, roles, moduleKeys, refreshTokenVersion),
      refreshToken,
    };
  }

  private async buildPlatformAdminSession(
    user: AuthUser,
    refreshTokenVersion: number,
  ) {
    const refreshToken = await this.createRefreshToken(
      { usuarioId: user.id },
      refreshTokenVersion,
    );

    return {
      ...this.buildPlatformAdminAccessResponse(user, refreshTokenVersion),
      refreshToken,
    };
  }

  private buildPlatformAdminAccessResponse(
    user: AuthUser,
    refreshTokenVersion: number,
  ) {
    const roles = ['SUPERADMIN'];
    const moduleKeys: string[] = [];
    const accessToken = this.jwtService.sign({
      sub: user.id.toString(),
      nombre: user.nombre,
      apellido: user.apellido,
      email: user.email,
      telefono: user.telefono,
      roles,
      moduleKeys,
      refreshTokenVersion,
    });

    return {
      accessToken,
      usuario: {
        id: user.id.toString(),
        nombre: user.nombre,
        apellido: user.apellido,
        email: user.email,
        telefono: user.telefono,
        roles,
        moduleKeys,
      },
    };
  }

  private buildAccessResponse(
    user: AuthCompany,
    roles: string[],
    moduleKeys: string[],
    refreshTokenVersion: number,
  ) {
    const planStatus = this.plansService.getStatus(user);
    const isOwner = roles.includes('OWNER');
    const sucursalId = isOwner ? null : (user.sucursalId?.toString() ?? null);
    const visibilidadOperaciones = isOwner
      ? 'todas'
      : (user.visibilidadOperaciones ?? 'todas');
    const accessToken = this.jwtService.sign({
      sub: user.usuarioId.toString(),
      empresaId: user.empresaId.toString(),
      empresaUsuarioId: user.empresaUsuarioId.toString(),
      empresaNombreComercial: user.nombreComercial,
      empresaLogoUrl: user.logoUrl,
      nombre: user.nombre,
      apellido: user.apellido,
      email: user.email,
      telefono: user.telefono,
      roles,
      moduleKeys,
      planCode: user.planCodigo,
      planStatus,
      planStartsAt: user.planInicioAt.toISOString(),
      planEndsAt: user.planFinAt?.toISOString() ?? null,
      refreshTokenVersion,
      sucursalId,
      visibilidadOperaciones,
    });

    return {
      accessToken,
      usuario: {
        id: user.usuarioId.toString(),
        nombre: user.nombre,
        apellido: user.apellido,
        email: user.email,
        telefono: user.telefono,
        roles,
        moduleKeys,
        planCode: user.planCodigo,
        planStatus,
        planStartsAt: user.planInicioAt,
        planEndsAt: user.planFinAt,
        sucursalId,
        visibilidadOperaciones,
      },
      empresa: {
        id: user.empresaId.toString(),
        nombreComercial: user.nombreComercial,
        logoUrl: user.logoUrl,
        planCode: user.planCodigo,
        planStatus,
        planStartsAt: user.planInicioAt,
        planEndsAt: user.planFinAt,
      },
    };
  }

  private getSessionModuleKeys(
    company: {
      planCodigo: PlanCodigo;
      planInicioAt: Date;
      planFinAt: Date | null;
    },
    roles: string[],
    modules: { moduleKey: string }[],
  ) {
    return this.plansService.getEffectiveModuleKeys(
      company,
      roles,
      modules.map((module) => module.moduleKey),
    );
  }

  private async findActiveCompanyUser(user: JwtPayload) {
    if (!user.empresaId) {
      throw new UnauthorizedException('El usuario no tiene empresa activa');
    }

    const current = await this.prisma.empresaUsuario.findFirst({
      where: {
        usuarioId: BigInt(user.sub),
        empresaId: BigInt(user.empresaId),
        estado: EmpresaUsuarioEstado.activo,
        empresa: { estado: EmpresaEstado.activa },
      },
      include: {
        usuario: true,
        empresa: true,
        roles: { include: { rol: true } },
        modulos: true,
        sucursal: true,
      },
    });

    if (!current || current.usuario.estado !== UsuarioEstado.activo) {
      throw new UnauthorizedException('Sesion no valida');
    }

    return current;
  }

  private async findPlatformAdmin(user: JwtPayload) {
    const current = await this.prisma.usuario.findFirst({
      where: {
        id: BigInt(user.sub),
        estado: UsuarioEstado.activo,
        esSuperAdmin: true,
      },
    });

    if (!current) {
      throw new UnauthorizedException('Sesion no valida');
    }

    return current;
  }

  private buildAuthSessionFromCompanyUser(
    companyUser: Awaited<ReturnType<AuthService['findActiveCompanyUser']>>,
    usuario: {
      id: bigint;
      nombre: string;
      apellido: string | null;
      email: string;
      telefono: string | null;
      refreshTokenVersion: number;
    },
  ) {
    const roles = companyUser.roles.map(({ rol }) => rol.codigo);

    return this.buildAuthSession(
      {
        empresaId: companyUser.empresa.id,
        nombreComercial: companyUser.empresa.nombreComercial,
        logoUrl: companyUser.empresa.logoUrl ?? null,
        usuarioId: usuario.id,
        nombre: usuario.nombre,
        apellido: usuario.apellido,
        email: usuario.email,
        telefono: usuario.telefono,
        empresaUsuarioId: companyUser.id,
        planCodigo: companyUser.empresa.planCodigo,
        planInicioAt: companyUser.empresa.planInicioAt,
        planFinAt: companyUser.empresa.planFinAt,
        sucursalId: companyUser.sucursalId,
        visibilidadOperaciones: companyUser.visibilidadOperaciones,
      },
      roles,
      this.getSessionModuleKeys(
        companyUser.empresa,
        roles,
        companyUser.modulos,
      ),
      usuario.refreshTokenVersion,
    );
  }

  private async createRefreshToken(
    user: { usuarioId: bigint; empresaId?: bigint },
    refreshTokenVersion: number,
  ) {
    const refreshToken = randomBytes(64).toString('base64url');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.refreshTokenTtlDays);

    await this.prisma.refreshToken.create({
      data: {
        usuarioId: user.usuarioId,
        empresaId: user.empresaId ?? null,
        tokenHash: this.hashToken(refreshToken),
        refreshTokenVersion,
        expiresAt,
      },
    });

    return refreshToken;
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
}
