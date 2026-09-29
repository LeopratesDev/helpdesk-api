import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { Priority } from '@prisma/client';
import { SlaService } from '../src/sla/sla.service';
import { computeSlaDueAt } from '../src/sla/sla.policy';
import { WorkerModule } from '../src/worker.module';
import request from 'supertest';
import { createTestApp, createUser, loginAs, TestContext } from './setup-e2e';

const HOUR = 3_600_000;

describe('SLA: marcação de vencidos e job agendado (integração)', () => {
  let ctx: TestContext;
  let redis: StartedRedisContainer;
  let requesterId: string;

  /** Cria um chamado aberto "horas" atrás, com o prazo calculado pela política real. */
  const ticketOpenedAgo = async (hours: number, priority: Priority, extra = {}) => {
    const createdAt = new Date(Date.now() - hours * HOUR);
    return ctx.prisma.ticket.create({
      data: {
        title: 't',
        description: 'd',
        priority,
        requesterId,
        createdAt,
        slaDueAt: computeSlaDueAt(priority, createdAt),
        ...extra,
      },
    });
  };

  beforeAll(async () => {
    redis = await new RedisContainer('redis:7-alpine').start();
    ctx = await createTestApp({ REDIS_URL: redis.getConnectionUrl() });
    requesterId = (await createUser(ctx.prisma, 'CLIENTE')).id;
  }, 180_000);

  afterAll(async () => {
    await ctx?.stop();
    await redis?.stop();
  });

  beforeEach(async () => {
    await ctx.prisma.comment.deleteMany();
    await ctx.prisma.ticketHistory.deleteMany();
    await ctx.prisma.ticket.deleteMany();
  });

  describe('SlaService.markOverdue', () => {
    it('marca só os vencidos sem resposta e audita como ação do sistema', async () => {
      const overdue = await ticketOpenedAgo(5, 'CRITICA'); // prazo 4h → vencido
      await ticketOpenedAgo(3, 'CRITICA'); // prazo 4h → ainda no prazo
      await ticketOpenedAgo(30, 'MEDIA', { firstResponseAt: new Date() }); // já respondido
      await ticketOpenedAgo(60, 'BAIXA', { status: 'RESOLVIDO', firstResponseAt: new Date() });

      const ids = await new SlaService(ctx.prisma).markOverdue(new Date());

      expect(ids).toEqual([overdue.id]);
      const breached = await ctx.prisma.ticket.findMany({ where: { slaBreached: true } });
      expect(breached.map((t) => t.id)).toEqual([overdue.id]);
      const history = await ctx.prisma.ticketHistory.findMany({ where: { ticketId: overdue.id } });
      expect(history).toEqual([
        expect.objectContaining({
          field: 'slaBreached',
          oldValue: 'false',
          newValue: 'true',
          actorId: null,
        }),
      ]);
    });

    it('é idempotente: rodar de novo não marca nem audita em dobro', async () => {
      await ticketOpenedAgo(10, 'ALTA');
      const sla = new SlaService(ctx.prisma);

      expect(await sla.markOverdue(new Date())).toHaveLength(1);
      expect(await sla.markOverdue(new Date())).toHaveLength(0);
      expect(await ctx.prisma.ticketHistory.count({ where: { field: 'slaBreached' } })).toBe(1);
    });

    it('execuções simultâneas também não duplicam', async () => {
      await ticketOpenedAgo(10, 'ALTA');
      await ticketOpenedAgo(10, 'CRITICA');
      const sla = new SlaService(ctx.prisma);

      const results = await Promise.all([sla.markOverdue(new Date()), sla.markOverdue(new Date())]);

      expect(results.flat()).toHaveLength(2);
      expect(await ctx.prisma.ticketHistory.count({ where: { field: 'slaBreached' } })).toBe(2);
    });
  });

  describe('primeira resposta atrasada (via API)', () => {
    let atendente: string;
    beforeAll(async () => {
      await createUser(ctx.prisma, 'ATENDENTE');
      atendente = await loginAs(ctx.app, 'atendente@test.dev');
    });
    const http = () => request(ctx.app.getHttpServer());

    it('assumir o chamado depois do prazo marca SLA estourado', async () => {
      const late = await ticketOpenedAgo(5, 'CRITICA');
      const res = await http()
        .patch(`/tickets/${late.id}/status`)
        .set('Authorization', `Bearer ${atendente}`)
        .send({ status: 'EM_ATENDIMENTO' });
      expect(res.body.slaBreached).toBe(true);
    });

    it('responder por comentário dentro do prazo mantém o SLA', async () => {
      const onTime = await ticketOpenedAgo(1, 'CRITICA');
      await http()
        .post(`/tickets/${onTime.id}/comments`)
        .set('Authorization', `Bearer ${atendente}`)
        .send({ body: 'Olá!' })
        .expect(201);
      const t = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: onTime.id } });
      expect(t.firstResponseAt).not.toBeNull();
      expect(t.slaBreached).toBe(false);
    });

    it('responder por comentário depois do prazo marca SLA estourado', async () => {
      const late = await ticketOpenedAgo(9, 'ALTA');
      await http()
        .post(`/tickets/${late.id}/comments`)
        .set('Authorization', `Bearer ${atendente}`)
        .send({ body: 'Desculpe a demora' })
        .expect(201);
      expect(
        (await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: late.id } })).slaBreached,
      ).toBe(true);
    });
  });

  describe('job agendado no worker (BullMQ + Redis reais)', () => {
    let worker: INestApplicationContext;

    afterEach(async () => worker?.close());

    it('o worker agenda o job e ele marca o chamado vencido sem intervenção', async () => {
      const overdue = await ticketOpenedAgo(5, 'CRITICA');
      process.env.SLA_CHECK_INTERVAL_MS = '1000';

      worker = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
      await worker.init();

      // espera até 10s o job rodar
      let flagged = false;
      for (let i = 0; i < 40 && !flagged; i++) {
        await new Promise((r) => setTimeout(r, 250));
        flagged = (await ctx.prisma.ticket.findUniqueOrThrow({ where: { id: overdue.id } }))
          .slaBreached;
      }
      expect(flagged).toBe(true);
    }, 30_000);
  });
});
