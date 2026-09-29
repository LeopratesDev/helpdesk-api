import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/auth.module';
import { CategoriesModule } from './categories/categories.module';
import { loggerParams } from './common/logger';
import { ConfigModule, ENV } from './config/config.module';
import { Env } from './config/env.schema';
import { HealthModule } from './health/health.module';
import { MetricsModule } from './metrics/metrics.module';
import { PrismaModule } from './prisma/prisma.module';
import { AdminQueuesModule } from './queue/admin-queues.module';
import { QueueModule } from './queue/queue.module';
import { TicketsModule } from './tickets/tickets.module';
import { TriageModule } from './triage/triage.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({ inject: [ENV], useFactory: (env: Env) => loggerParams(env) }),
    PrismaModule,
    QueueModule,
    AuthModule,
    UsersModule,
    CategoriesModule,
    TicketsModule,
    TriageModule,
    MetricsModule,
    AdminQueuesModule,
    HealthModule,
  ],
})
export class AppModule {}
