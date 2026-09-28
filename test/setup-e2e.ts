import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
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
  stop: () => Promise<void>;
}

/**
 * Sobe um PostgreSQL real em container (Testcontainers), aplica as migrations
 * e cria a aplicação Nest completa (guards, pipes, filtro) — igual à produção.
 */
export async function createTestApp(env: Record<string, string> = {}): Promise<TestContext> {
  const pg: StartedPostgreSqlContainer = await new PostgreSqlContainer(
    'postgres:17-alpine',
  ).start();
  const databaseUrl = pg.getConnectionUri();

  Object.assign(process.env, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: databaseUrl,
    JWT_SECRET: 'test-secret-with-at-least-32-characters!!',
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
    stop: async () => {
      await app.close();
      await pg.stop();
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
