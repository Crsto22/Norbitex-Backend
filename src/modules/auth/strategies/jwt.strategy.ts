import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../prisma/prisma.service';
import { JwtPayload } from '../types/jwt-payload.type';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET', 'dev_secret_change_me'),
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    if (payload.refreshTokenVersion !== undefined) {
      const usuario = await this.prisma.usuario.findUnique({
        where: { id: BigInt(payload.sub) },
        select: { refreshTokenVersion: true },
      });

      if (!usuario || usuario.refreshTokenVersion !== payload.refreshTokenVersion) {
        throw new UnauthorizedException('Sesion no valida');
      }
    }

    return payload;
  }
}