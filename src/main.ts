import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { validateEnv } from './config/env.schema';

async function bootstrap(): Promise<void> {
  // Valida antes de criar a app: config inválida → processo nem sobe
  const env = validateEnv(process.env);
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  configureApp(app);
  await app.listen(env.PORT);
}

void bootstrap();
