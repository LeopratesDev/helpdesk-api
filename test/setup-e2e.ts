import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import { hash } from '@node-rs/argon2';
import { Role } from '@prisma/client';
import { execSync } from 'node:child_process';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

export const PASSWORD = 'Senha@123';

export interface TestContext {
  app: INestApplication<App>;
  prisma: PrismaService;
  redisUrl: string;
  stop: () => Promise<void>;
}

/**
 * Sobe PostgreSQL e Redis reais em containers (Testcontainers), aplica as migrations
 * e cria a aplicação Nest completa (guards, pipes, filtro) — igual à produção.
 * ANTHROPIC_API_KEY fica vazia: nenhum teste chama o LLM de verdade.
 */
export async function createTestApp(env: Record<string, string> = {}): Promise<TestContext> {
  const [pg, redis] = await Promise.all([
    new PostgreSqlContainer('postgres:17-alpine').start(),
    new RedisContainer('redis:7-alpine').start(),
  ]);

  Object.assign(process.env, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: pg.getConnectionUri(),
    REDIS_URL: redis.getConnectionUrl(),
    JWT_SECRET: 'test-secret-with-at-least-32-characters!!',
    ANTHROPIC_API_KEY: '',
    ...env,
  });
  execSync('npx prisma migrate deploy', { env: process.env, stdio: 'ignore' });

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
  configureApp(app);
  await app.init();

  return {
    app,
    prisma: app.get(PrismaService),
    redisUrl: redis.getConnectionUrl(),
    stop: async () => {
      await app.close();
      await Promise.all([pg.stop(), redis.stop()]);
    },
  };
}

export async function createUser(
  prisma: PrismaService,
  role: Role,
  email = `${role.toLowerCase()}@test.dev`,
) {
  return prisma.user.create({
    data: { name: role, email, role, passwordHash: await hash(PASSWORD) },
  });
}

export async function loginAs(app: INestApplication<App>, email: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password: PASSWORD });
  return (res.body as { accessToken: string }).accessToken;
}

/** Espera uma condição assíncrona virar verdadeira (para efeitos do worker). */
export async function waitFor(check: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Condição não satisfeita em ${timeoutMs} ms`);
}
