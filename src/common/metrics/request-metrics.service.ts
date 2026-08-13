import { Injectable } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

type RouteMetric = {
  count: number;
  errors: number;
  totalMs: number;
  maxMs: number;
};

@Injectable()
export class RequestMetricsService {
  private readonly startedAt = new Date();
  private readonly routes = new Map<string, RouteMetric>();
  private total = 0;
  private inFlight = 0;
  private totalMs = 0;
  private maxMs = 0;
  private byStatus: Record<string, number> = {};

  middleware() {
    return (request: Request, response: Response, next: NextFunction) => {
      const start = process.hrtime.bigint();
      this.inFlight += 1;

      response.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
        this.record(request, response.statusCode, durationMs);
      });

      next();
    };
  }

  snapshot() {
    const routes = Object.fromEntries(
      [...this.routes.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([route, metric]) => [
          route,
          {
            count: metric.count,
            errors: metric.errors,
            avgMs: this.round(metric.totalMs / metric.count),
            maxMs: this.round(metric.maxMs),
          },
        ]),
    );

    return {
      startedAt: this.startedAt.toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      requests: {
        total: this.total,
        inFlight: this.inFlight,
        byStatus: this.byStatus,
        avgMs: this.total ? this.round(this.totalMs / this.total) : 0,
        maxMs: this.round(this.maxMs),
      },
      routes,
    };
  }

  private record(request: Request, statusCode: number, durationMs: number) {
    this.inFlight = Math.max(0, this.inFlight - 1);
    this.total += 1;
    this.totalMs += durationMs;
    this.maxMs = Math.max(this.maxMs, durationMs);

    const statusFamily = `${Math.floor(statusCode / 100)}xx`;
    this.byStatus = {
      ...this.byStatus,
      [statusFamily]: (this.byStatus[statusFamily] ?? 0) + 1,
    };

    const route = this.routeKey(request);
    const metric = this.routes.get(route) ?? {
      count: 0,
      errors: 0,
      totalMs: 0,
      maxMs: 0,
    };
    metric.count += 1;
    metric.errors += statusCode >= 500 ? 1 : 0;
    metric.totalMs += durationMs;
    metric.maxMs = Math.max(metric.maxMs, durationMs);
    this.routes.set(route, metric);
  }

  private routeKey(request: Request) {
    const [segment = 'root'] = request.path.split('/').filter(Boolean);
    return `${request.method} /${segment}`;
  }

  private round(value: number) {
    return Number(value.toFixed(2));
  }
}
