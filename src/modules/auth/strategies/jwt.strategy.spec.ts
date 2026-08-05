import { ConfigService } from '@nestjs/config';
import { UsuarioEstado } from '@prisma/client';
import { UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { PlansService } from '../../plans/plans.service';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy platform admin', () => {
  it('only accepts company setup tokens without a company or session version', async () => {
    const strategy = new JwtStrategy(
      new ConfigService(),
      {} as PrismaService,
      {} as PlansService,
    );
    const setupPayload = { sub: '9', roles: [], setup: 'company' as const };

    await expect(strategy.validate(setupPayload)).resolves.toEqual(
      setupPayload,
    );
    await expect(
      strategy.validate({ sub: '9', roles: [] }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('only accepts a current platform administrator without a company', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      estado: UsuarioEstado.activo,
      esSuperAdmin: true,
      refreshTokenVersion: 4,
    });
    const strategy = new JwtStrategy(
      new ConfigService(),
      { usuario: { findUnique } } as unknown as PrismaService,
      {} as PlansService,
    );
    const payload = {
      sub: '9',
      roles: [],
      refreshTokenVersion: 4,
    };

    await expect(strategy.validate(payload)).resolves.toEqual({
      ...payload,
      roles: ['SUPERADMIN'],
      moduleKeys: [],
    });

    findUnique.mockResolvedValue({
      estado: UsuarioEstado.activo,
      esSuperAdmin: false,
      refreshTokenVersion: 4,
    });
    await expect(strategy.validate(payload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
