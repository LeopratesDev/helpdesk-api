import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { loggerParams } from './common/logger';
import { ConfigModule, ENV } from './config/config.module';
import { Env } from './config/env.schema';
import { PrismaModule } from './prisma/prisma.module';
import { SlaModule } from './sla/sla.module';

/** Módulo raiz do processo worker: sem HTTP, só consumidores de fila. */
@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({ inject: [ENV], useFactory: (env: Env) => loggerParams(env) }),
    PrismaModule,
    SlaModule,
  ],
})
export class WorkerModule {}
