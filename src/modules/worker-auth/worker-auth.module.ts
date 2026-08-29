import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../../prisma/prisma.module';
import { WorkerAuthController } from './worker-auth.controller';
import { WorkerAuthService } from './worker-auth.service';

@Module({
  imports: [
    PrismaModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET', 'dev_secret_change_me'),
        signOptions: {
          expiresIn: Number(configService.get('JWT_EXPIRES_IN_SECONDS', '900')),
        },
      }),
    }),
  ],
  controllers: [WorkerAuthController],
  providers: [WorkerAuthService],
})
export class WorkerAuthModule {}
