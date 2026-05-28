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
  Prisma,
  UsuarioEstado,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { ValidateResetTokenDto } from './dto/validate-reset-token.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { JwtPayload } from './types/jwt-payload.type';

type AuthCompany = {
  empresaId: bigint;
  nombreComercial: string;
  logoUrl: string | null;
  usuarioId: bigint;
  nombre: string;
  apellido: string | null;
  email: string;
  empresaUsuarioId: bigint;
  refreshTokenVersion?: number;
};

type AuthSession = ReturnType<AuthService['buildAccessResponse']> & {
  refreshToken: string;
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
  ) {}

  async register(dto: RegisterDto) {
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
    expiresAt.setMinutes(expiresAt.getMinutes() + this.verificationCodeTtlMinutes);

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

    this.mailService.sendVerificationCode(email, code);

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

    const usuarioId = BigInt(user.sub);
    const ruc = dto.ruc?.trim() || undefined;

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
          refreshTokenVersion: true,
          empresas: { select: { id: true }, take: 1 },
        },
      });

      if (!usuario) {
        throw new UnauthorizedException('Usuario no valido');
      }

      if (usuario.empresas.length > 0) {
        throw new ConflictException('El usuario ya esta asociado a una empresa');
      }

      if (ruc) {
        await this.ensureRucIsAvailable(tx, ruc);
      }

      const ownerRole = await tx.rol.findUnique({ where: { codigo: 'OWNER' } });

      if (!ownerRole) {
        throw new ConflictException('El rol OWNER no existe');
      }

      const empresa = await tx.empresa.create({
        data: {
          nombreComercial: dto.nombreComercial,
          tipoNegocio: dto.tipoNegocio,
          categoriasProducto: dto.categoriasProducto,
          razonSocial: dto.razonSocial ?? null,
          ruc: ruc ?? null,
          telefono: dto.telefonoEmpresa ?? null,
          email: dto.emailEmpresa ?? null,
          direccion: dto.direccion ?? null,
          comoConocio: dto.comoConocio,
          comoConocioOtro: dto.comoConocioOtro ?? null,
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
        ],
      });

      await tx.metodoPago.createMany({
        data: defaultPaymentMethods.map((method) => ({
          empresaId: empresa.id,
          ...method,
        })),
      });

      return {
        empresaId: empresa.id,
        nombreComercial: empresa.nombreComercial,
        logoUrl: empresa.logoUrl ?? null,
        usuarioId: usuario.id,
        nombre: usuario.nombre,
        apellido: usuario.apellido,
        email: usuario.email,
        empresaUsuarioId: empresaUsuario.id,
        refreshTokenVersion: usuario.refreshTokenVersion + 1,
      };
    });

    await this.prisma.usuario.update({
      where: { id: result.usuarioId },
      data: { refreshTokenVersion: result.refreshTokenVersion },
    });

    return this.buildAuthSession(result, ['OWNER'], result.refreshTokenVersion);
  }

  async login(dto: LoginDto) {
    const usuario = await this.prisma.usuario.findFirst({
      where: {
        email: dto.email.toLowerCase(),
        estado: UsuarioEstado.activo,
        emailVerificado: true,
        empresas: {
          some: {
            estado: EmpresaUsuarioEstado.activo,
            empresa: {
              estado: EmpresaEstado.activa,
              ...(dto.ruc ? { ruc: dto.ruc } : {}),
            },
          },
        },
      },
      include: {
        empresas: {
          where: {
            estado: EmpresaUsuarioEstado.activo,
            empresa: {
              estado: EmpresaEstado.activa,
              ...(dto.ruc ? { ruc: dto.ruc } : {}),
            },
          },
          include: {
            empresa: true,
            roles: {
              include: {
                rol: true,
              },
            },
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
      !empresaUsuario ||
      !(await bcrypt.compare(dto.password, usuario.passwordHash))
    ) {
      throw new UnauthorizedException('Credenciales invalidas');
    }

    const refreshTokenVersion = usuario.refreshTokenVersion + 1;

    await this.prisma.usuario.update({
      where: { id: usuario.id },
      data: { refreshTokenVersion },
    });

    return this.buildAuthSession(
      {
        empresaId: empresaUsuario.empresa.id,
        nombreComercial: empresaUsuario.empresa.nombreComercial,
        logoUrl: empresaUsuario.empresa.logoUrl ?? null,
        usuarioId: usuario.id,
        nombre: usuario.nombre,
        apellido: usuario.apellido,
        email: usuario.email,
        empresaUsuarioId: empresaUsuario.id,
      },
      empresaUsuario.roles.map(({ rol }) => rol.codigo),
      refreshTokenVersion,
    );
  }

  async forgotPassword(dto: ForgotPasswordDto) {
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

    this.mailService.sendPasswordResetToken(usuario.email, token);

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

  async refresh(refreshToken?: string): Promise<AuthSession> {
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

    if (!storedToken?.empresa || storedToken.usuario.estado !== UsuarioEstado.activo) {
      throw new UnauthorizedException('Sesion no valida');
    }

    if (storedToken.refreshTokenVersion !== storedToken.usuario.refreshTokenVersion) {
      await this.prisma.refreshToken.update({
        where: { id: storedToken.id },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Sesion no valida');
    }

    const empresaUsuario = await this.prisma.empresaUsuario.findFirst({
      where: {
        usuarioId: storedToken.usuarioId,
        empresaId: storedToken.empresaId ?? undefined,
        estado: EmpresaUsuarioEstado.activo,
        empresa: { estado: EmpresaEstado.activa },
      },
      include: {
        empresa: true,
        roles: { include: { rol: true } },
      },
    });

    if (!empresaUsuario) {
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

    return this.buildAuthSession(
      {
        empresaId: empresaUsuario.empresa.id,
        nombreComercial: empresaUsuario.empresa.nombreComercial,
        logoUrl: empresaUsuario.empresa.logoUrl ?? null,
        usuarioId: storedToken.usuario.id,
        nombre: storedToken.usuario.nombre,
        apellido: storedToken.usuario.apellido,
        email: storedToken.usuario.email,
        empresaUsuarioId: empresaUsuario.id,
      },
      empresaUsuario.roles.map(({ rol }) => rol.codigo),
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
      throw new ConflictException('El email ya esta registrado');
    }
  }

  private async ensureRucIsAvailable(tx: Prisma.TransactionClient, ruc: string) {
    const empresa = await tx.empresa.findUnique({
      where: { ruc },
      select: { id: true },
    });

    if (empresa) {
      throw new ConflictException('El RUC ya esta registrado');
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
      throw new BadRequestException('El enlace de restablecimiento no es valido.');
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
    });
  }

  private async buildAuthSession(
    user: AuthCompany,
    roles: string[],
    refreshTokenVersion: number,
  ): Promise<AuthSession> {
    const refreshToken = await this.createRefreshToken(user, refreshTokenVersion);

    return {
      ...this.buildAccessResponse(user, roles, refreshTokenVersion),
      refreshToken,
    };
  }

  private buildAccessResponse(user: AuthCompany, roles: string[], refreshTokenVersion: number) {
    const accessToken = this.jwtService.sign({
      sub: user.usuarioId.toString(),
      empresaId: user.empresaId.toString(),
      empresaUsuarioId: user.empresaUsuarioId.toString(),
      empresaNombreComercial: user.nombreComercial,
      empresaLogoUrl: user.logoUrl,
      nombre: user.nombre,
      apellido: user.apellido,
      email: user.email,
      roles,
      refreshTokenVersion,
    });

    return {
      accessToken,
      usuario: {
        id: user.usuarioId.toString(),
        nombre: user.nombre,
        apellido: user.apellido,
        email: user.email,
        roles,
      },
      empresa: {
        id: user.empresaId.toString(),
        nombreComercial: user.nombreComercial,
        logoUrl: user.logoUrl,
      },
    };
  }

  private async createRefreshToken(user: AuthCompany, refreshTokenVersion: number) {
    const refreshToken = randomBytes(64).toString('base64url');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.refreshTokenTtlDays);

    await this.prisma.refreshToken.create({
      data: {
        usuarioId: user.usuarioId,
        empresaId: user.empresaId,
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
