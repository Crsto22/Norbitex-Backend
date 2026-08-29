import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { WorkerController } from './worker.controller';
import { WorkerJwtGuard } from './guards/worker-jwt.guard';
import { WorkerService } from './worker.service';

@Module({
  imports: [PrismaModule],
  controllers: [WorkerController],
  providers: [WorkerService, WorkerJwtGuard],
})
export class WorkerModule {}
