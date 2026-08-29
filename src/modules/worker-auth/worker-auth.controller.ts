import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { rateLimits } from '../../common/rate-limits';
import { ConfirmActivationDto } from './dto/confirm-activation.dto';
import { ValidateActivationDto } from './dto/validate-activation.dto';
import { WorkerLookupDto } from './dto/worker-lookup.dto';
import { WorkerLoginDto } from './dto/worker-login.dto';
import { WorkerAuthService } from './worker-auth.service';

@Public()
@Controller('worker-auth')
export class WorkerAuthController {
  constructor(private readonly workerAuthService: WorkerAuthService) {}

  @Post('activation/validate')
  @Throttle(rateLimits.workerAuth)
  validateActivation(@Body() dto: ValidateActivationDto) {
    return this.workerAuthService.validateActivation(dto);
  }

  @Post('activation/confirm')
  @Throttle(rateLimits.workerAuth)
  confirmActivation(@Body() dto: ConfirmActivationDto) {
    return this.workerAuthService.confirmActivation(dto);
  }

  @Post('login')
  @Throttle(rateLimits.workerAuth)
  login(@Body() dto: WorkerLoginDto) {
    return this.workerAuthService.login(dto);
  }

  @Post('lookup')
  @Throttle(rateLimits.workerAuth)
  lookup(@Body() dto: WorkerLookupDto) {
    return this.workerAuthService.lookup(dto);
  }

  @Post('logout')
  @Throttle(rateLimits.workerAuth)
  logout() {
    return { message: 'Sesion cerrada correctamente' };
  }
}
