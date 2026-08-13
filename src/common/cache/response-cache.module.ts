import { Global, Module } from '@nestjs/common';
import { ResponseCacheService } from './response-cache.service';

@Global()
@Module({
  providers: [ResponseCacheService],
  exports: [ResponseCacheService],
})
export class ResponseCacheModule {}
