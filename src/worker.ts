import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { validateEnv } from './config/env.schema';
import { WorkerModule } from './worker.module';

/**
 * Segundo ponto de entrada: mesmo código da API, outro processo.
 * createApplicationContext = Nest sem servidor HTTP (só injeção de dependência).
 */
async function bootstrap(): Promise<void> {
  validateEnv(process.env);
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
}

void bootstrap();
