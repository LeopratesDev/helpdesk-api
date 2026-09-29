import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/auth.module';
import { CategoriesModule } from './categories/categories.module';
import { loggerParams } from './common/logger';
import { ConfigModule, ENV } from './config/config.module';
import { Env } from './config/env.schema';
import { PrismaModule } from './prisma/prisma.module';
import { TicketsModule } from './tickets/tickets.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({ inject: [ENV], useFactory: (env: Env) => loggerParams(env) }),
    PrismaModule,
    AuthModule,
    UsersModule,
    CategoriesModule,
    TicketsModule,
  ],
})
export class AppModule {}
