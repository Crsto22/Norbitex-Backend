import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AttendanceTimeEntriesController } from './attendance-time-entries.controller';
import { AttendanceTimeEntriesService } from './attendance-time-entries.service';

@Module({
  imports: [PrismaModule],
  controllers: [AttendanceTimeEntriesController],
  providers: [AttendanceTimeEntriesService],
})
export class AttendanceTimeEntriesModule {}
