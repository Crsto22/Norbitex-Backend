import { Injectable } from '@nestjs/common';
import { RequestMetricsService } from './common/metrics/request-metrics.service';
import { PrismaService } from './prisma/prisma.service';

@Injectable()
export class AppService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: RequestMetricsService,
  ) {}

  getHello(): string {
    return 'Norbitex API';
  }

  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  metricsSnapshot() {
    return this.metrics.snapshot();
  }
}
