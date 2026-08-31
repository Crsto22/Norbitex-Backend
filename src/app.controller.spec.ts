import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RequestMetricsService } from './common/metrics/request-metrics.service';
import { PrismaService } from './prisma/prisma.service';
import { ConfigService } from '@nestjs/config';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        {
          provide: PrismaService,
          useValue: {
            $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
          },
        },
        {
          provide: RequestMetricsService,
          useValue: {
            snapshot: jest.fn().mockReturnValue({ requests: { total: 0 } }),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'METRICS_TOKEN' ? 'metrics-secret' : undefined,
            ),
          },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should identify the API', () => {
      expect(appController.getHello()).toBe('Nuvex API');
    });
  });

  describe('metrics', () => {
    it('should return metrics with the metrics token', () => {
      expect(appController.metrics('metrics-secret')).toEqual({
        requests: { total: 0 },
      });
    });

    it('should reject metrics without the metrics token', () => {
      expect(() => appController.metrics()).toThrow(
        'Token de metricas invalido',
      );
    });
  });
});
