import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { validateEnv } from './config/env.schema';

async function bootstrap(): Promise<void> {
  const env = validateEnv(process.env);
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: env.CORS_ORIGINS.split(',') });
  app.enableShutdownHooks();
  await app.listen(env.PORT);
}

void bootstrap();
