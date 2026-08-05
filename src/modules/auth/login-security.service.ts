import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { TurnstileService } from './turnstile.service';

const challengeThreshold = 3;
const attemptWindowMs = 15 * 60 * 1000;

@Injectable()
export class LoginSecurityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly turnstileService: TurnstileService,
  ) {}

  async enforce(email: string, ip: string, token?: string) {
    const keys = this.getKeys(email, ip);
    const cutoff = new Date(Date.now() - attemptWindowMs);
    const challenge = await this.prisma.loginIntento.findFirst({
      where: {
        claveHash: { in: keys },
        intentos: { gte: challengeThreshold },
        ultimoIntentoAt: { gte: cutoff },
      },
      select: { id: true },
    });

    if (!challenge) return;
    if (!token) this.throwChallengeRequired();
    await this.turnstileService.verify(token, 'login', ip);
  }

  async recordFailure(email: string, ip: string) {
    const keys = this.getKeys(email, ip);
    const now = new Date();
    const cutoff = new Date(now.getTime() - attemptWindowMs);
    const attempts = await this.prisma.$transaction(async (tx) => {
      await tx.loginIntento.updateMany({
        where: { claveHash: { in: keys }, ultimoIntentoAt: { lt: cutoff } },
        data: { intentos: 0 },
      });

      return Promise.all(
        keys.map((claveHash) =>
          tx.loginIntento.upsert({
            where: { claveHash },
            create: { claveHash, intentos: 1, ultimoIntentoAt: now },
            update: { intentos: { increment: 1 }, ultimoIntentoAt: now },
            select: { intentos: true },
          }),
        ),
      );
    });

    if (attempts.some(({ intentos }) => intentos >= challengeThreshold)) {
      this.throwChallengeRequired();
    }
  }

  clear(email: string, ip: string) {
    return this.prisma.loginIntento.deleteMany({
      where: { claveHash: { in: this.getKeys(email, ip) } },
    });
  }

  private getKeys(email: string, ip: string) {
    return [...new Set([`email:${email}`, ip ? `ip:${ip}` : ''])]
      .filter(Boolean)
      .map((value) => createHash('sha256').update(value).digest('hex'));
  }

  private throwChallengeRequired(): never {
    throw new UnauthorizedException({
      code: 'TURNSTILE_REQUIRED',
      message: 'Completa la verificacion de seguridad para continuar.',
    });
  }
}
