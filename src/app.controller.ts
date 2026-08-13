import {
  Controller,
  Get,
  Headers,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Public } from './common/decorators/public.decorator';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Public()
  @Get('health')
  health() {
    return this.appService.health();
  }

  @Public()
  @Get('metrics')
  metrics(
    @Headers('x-metrics-token') metricsToken?: string,
    @Headers('authorization') authorization?: string,
  ) {
    this.assertMetricsToken(metricsToken, authorization);
    return this.appService.metricsSnapshot();
  }

  private assertMetricsToken(metricsToken?: string, authorization?: string) {
    const expected = this.configService.get<string>('METRICS_TOKEN')?.trim();
    if (!expected) {
      throw new ServiceUnavailableException('Metricas no configuradas');
    }

    const received = metricsToken || authorization?.replace(/^Bearer\s+/i, '');
    if (received !== expected) {
      throw new UnauthorizedException('Token de metricas invalido');
    }
  }
}
