import { Test, TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';
import request from 'supertest';
import { TRIAGE_QUEUE, triageJobId } from '../src/queue/queue.constants';
import { redisConnection } from '../src/queue/redis-connection';
import { LLM_CLIENT, LlmClient, NonRetryableLlmError } from '../src/triage/llm/llm-client';
import { TriageService } from '../src/triage/triage.service';
import { TriageWorker } from '../src/triage/triage.worker';
import { WorkerModule } from '../src/worker.module';
import { createTestApp, createUser, loginAs, TestContext, waitFor } from './setup-e2e';

/** LLM falso controlado pelo teste: nunca chama a API real. */
const llm = { triage: jest.fn<ReturnType<LlmClient['triage']>, Parameters<LlmClient['triage']>>() };
const good = {
  category: 'Financeiro',
  priority: 'ALTA',
  summary: 'Cobrança duplicada',
  confidence: 0.9,
};
const reply = (raw: unknown) => Promise.resolve({ raw, model: 'mock-model' });

describe('Triagem por IA: fila, worker e decisão (integração)', () => {
  let ctx: TestContext;
  let worker: TestingModule | undefined;
  let cliente: string;
  let atendente: string;
  let admin: string;
  let financeiroId: string;
  let acessoId: string;
  const http = () => request(ctx.app.getHttpServer());

  const openTicket = async () => {
    const res = await http()
      .post('/tickets')
      .set('Authorization', `Bearer ${cliente}`)
      .send({ title: 'Cobrança duplicada', description: 'Fui cobrado duas vezes no cartão.' });
    expect(res.status).toBe(201);
    return res.body.id as string;
  };
  const suggestion = (ticketId: string) =>
    ctx.prisma.triageSuggestion.findUniqueOrThrow({ where: { ticketId } });
  const startWorker = async () => {
    worker = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(LLM_CLIENT)
      .useValue(llm)
      .compile();
    await worker.init();
  };

  beforeAll(async () => {
    ctx = await createTestApp({
      LOGIN_RATE_LIMIT: '1000',
      TRIAGE_MAX_ATTEMPTS: '3',
      TRIAGE_BACKOFF_MS: '50',
      LLM_TIMEOUT_MS: '300',
    });
    await Promise.all([
      createUser(ctx.prisma, 'CLIENTE'),
      createUser(ctx.prisma, 'ATENDENTE'),
      createUser(ctx.prisma, 'ADMIN'),
    ]);
    financeiroId = (await ctx.prisma.category.create({ data: { name: 'Financeiro' } })).id;
    acessoId = (await ctx.prisma.category.create({ data: { name: 'Acesso e login' } })).id;
    cliente = await loginAs(ctx.app, 'cliente@test.dev');
    atendente = await loginAs(ctx.app, 'atendente@test.dev');
    admin = await loginAs(ctx.app, 'admin@test.dev');
  }, 180_000);

  afterEach(async () => {
    await worker?.close();
    worker = undefined;
    llm.triage.mockReset();
  });

  afterAll(async () => ctx?.stop());

  describe('publicação (API)', () => {
    it('POST /tickets responde 201 sem chamar o LLM e publica um job com id determinístico', async () => {
      const id = await openTicket();

      expect(llm.triage).not.toHaveBeenCalled();
      expect((await suggestion(id)).status).toBe('PENDING');

      const queue = new Queue(TRIAGE_QUEUE, { connection: redisConnection(ctx.redisUrl) });
      const job = await queue.getJob(triageJobId(id));
      expect(job?.data).toEqual({ ticketId: id });
      expect(job?.opts.attempts).toBe(3);
      expect(job?.opts.backoff).toEqual({ type: 'exponential', delay: 50 });

      // Publicar de novo o mesmo chamado não cria um segundo job
      await queue.add('triage', { ticketId: id }, { jobId: triageJobId(id) });
      expect(await queue.getJobCountByTypes('waiting')).toBe(1);
      await queue.obliterate({ force: true });
      await queue.close();
    });
  });

  describe('processamento (worker)', () => {
    it('grava a sugestão validada, o texto usado, o modelo e o histórico', async () => {
      llm.triage.mockImplementation(() => reply(good));
      const id = await openTicket();
      await startWorker();

      await waitFor(async () => (await suggestion(id)).status === 'SUGGESTED');
      const s = await suggestion(id);
      expect(s).toMatchObject({
        suggestedCategory: 'Financeiro',
        suggestedPriority: 'ALTA',
        summary: 'Cobrança duplicada',
        confidence: 0.9,
        model: 'mock-model',
        attempts: 1,
      });
      expect(s.inputText).toContain('Fui cobrado duas vezes');
      expect(llm.triage.mock.calls[0]?.[0].categories).toEqual(['Acesso e login', 'Financeiro']);
      const history = await ctx.prisma.ticketHistory.findMany({
        where: { ticketId: id, field: 'triage' },
      });
      expect(history).toEqual([
        expect.objectContaining({ actorId: null, newValue: 'ALTA / Financeiro' }),
      ]);
    });

    it('idempotente: processar o mesmo chamado de novo não duplica nem sobrescreve', async () => {
      llm.triage.mockImplementation(() => reply(good));
      const id = await openTicket();
      await startWorker();
      await waitFor(async () => (await suggestion(id)).status === 'SUGGESTED');

      const service = worker!.get(TriageService);
      const outcomes = await Promise.all([service.process(id, 1), service.process(id, 1)]);

      expect(outcomes).toEqual(['skipped', 'skipped']);
      expect(llm.triage).toHaveBeenCalledTimes(1);
      expect(await ctx.prisma.triageSuggestion.count({ where: { ticketId: id } })).toBe(1);
      expect(
        await ctx.prisma.ticketHistory.count({ where: { ticketId: id, field: 'triage' } }),
      ).toBe(1);
    });

    it('duas execuções simultâneas do mesmo chamado: só uma grava', async () => {
      llm.triage.mockImplementation(() => reply(good));
      const id = await openTicket();
      // Módulo compilado sem init(): o consumidor da fila NÃO sobe; só as duas chamadas disputam
      worker = await Test.createTestingModule({ imports: [WorkerModule] })
        .overrideProvider(LLM_CLIENT)
        .useValue(llm)
        .compile();
      const service = worker.get(TriageService);

      const outcomes = await Promise.all([service.process(id, 1), service.process(id, 1)]);

      expect([...outcomes].sort()).toEqual(['skipped', 'suggested']);
      expect((await suggestion(id)).status).toBe('SUGGESTED');
      expect(
        await ctx.prisma.ticketHistory.count({ where: { ticketId: id, field: 'triage' } }),
      ).toBe(1);
    });

    it('saída inválida é descartada e o job é repetido com backoff até dar certo', async () => {
      llm.triage
        .mockImplementationOnce(() => reply({ ...good, priority: 'URGENTISSIMA' }))
        .mockImplementationOnce(() => reply('não é JSON'))
        .mockImplementation(() => reply(good));
      const id = await openTicket();
      await startWorker();

      await waitFor(async () => (await suggestion(id)).status === 'SUGGESTED');
      expect(llm.triage).toHaveBeenCalledTimes(3);
      expect((await suggestion(id)).attempts).toBe(3);
    });

    it('timeout em todas as tentativas: sugestão FAILED e job visível na dead letter', async () => {
      llm.triage.mockImplementation(() => new Promise(() => undefined)); // nunca responde
      const id = await openTicket();
      await startWorker();

      await waitFor(async () => (await suggestion(id)).status === 'FAILED', 15_000);
      const s = await suggestion(id);
      expect(s.error).toContain('não respondeu');
      expect(s.attempts).toBe(3);

      const failed = await http()
        .get('/admin/queues/failed')
        .set('Authorization', `Bearer ${admin}`);
      expect(failed.status).toBe(200);
      expect(failed.body).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ queue: 'triage', id: triageJobId(id), attemptsMade: 3 }),
        ]),
      );
    }, 30_000);

    it('varredura republica sugestão presa em PENDING (ex.: Redis estava fora ao abrir o chamado)', async () => {
      llm.triage.mockImplementation(() => reply(good));
      const id = await openTicket();
      // simula "publicação perdida": remove o job e envelhece a sugestão
      const queue = new Queue(TRIAGE_QUEUE, { connection: redisConnection(ctx.redisUrl) });
      await (await queue.getJob(triageJobId(id)))?.remove();
      await queue.close();
      await ctx.prisma.triageSuggestion.update({
        where: { ticketId: id },
        data: { createdAt: new Date(Date.now() - 10 * 60_000) },
      });

      await startWorker();
      // sweep é privado; no teste chamamos direto em vez de esperar os 5 min do agendamento
      const triageWorker = worker!.get<TriageWorker, { sweep: () => Promise<string> }>(
        TriageWorker,
      );
      expect(await triageWorker.sweep()).toMatch(/republicados: [1-9]/);

      await waitFor(async () => (await suggestion(id)).status === 'SUGGESTED');
    });

    it('erro não recuperável (ex.: chave inválida) falha sem repetir', async () => {
      llm.triage.mockImplementation(() =>
        Promise.reject(new NonRetryableLlmError('Anthropic 401')),
      );
      const id = await openTicket();
      await startWorker();

      await waitFor(async () => (await suggestion(id)).status === 'FAILED');
      expect(llm.triage).toHaveBeenCalledTimes(1);
      expect((await suggestion(id)).error).toContain('401');
    });
  });

  describe('decisão do atendente (API)', () => {
    const suggestedTicket = async () => {
      const id = await openTicket();
      await ctx.prisma.triageSuggestion.update({
        where: { ticketId: id },
        data: {
          status: 'SUGGESTED',
          suggestedCategory: 'Financeiro',
          suggestedPriority: 'CRITICA',
        },
      });
      return id;
    };

    it('aceitar aplica prioridade e categoria ao chamado; aceitar de novo é 409', async () => {
      const id = await suggestedTicket();

      const res = await http()
        .post(`/tickets/${id}/triage/accept`)
        .set('Authorization', `Bearer ${atendente}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'ACCEPTED',
        finalPriority: 'CRITICA',
        finalCategory: 'Financeiro',
      });

      const ticket = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id } });
      expect(ticket).toMatchObject({ priority: 'CRITICA', categoryId: financeiroId });
      // prazo de SLA recalculado para 4h (crítica)
      expect((ticket.slaDueAt.getTime() - ticket.createdAt.getTime()) / 3_600_000).toBe(4);

      const again = await http()
        .post(`/tickets/${id}/triage/accept`)
        .set('Authorization', `Bearer ${atendente}`);
      expect(again.status).toBe(409);
    });

    it('corrigir aplica os valores do atendente e registra como CORRECTED', async () => {
      const id = await suggestedTicket();

      const res = await http()
        .post(`/tickets/${id}/triage/correct`)
        .set('Authorization', `Bearer ${atendente}`)
        .send({ priority: 'BAIXA', categoryId: acessoId });

      expect(res.body).toMatchObject({
        status: 'CORRECTED',
        finalPriority: 'BAIXA',
        finalCategory: 'Acesso e login',
      });
      expect(await ctx.prisma.ticket.findUniqueOrThrow({ where: { id } })).toMatchObject({
        priority: 'BAIXA',
        categoryId: acessoId,
      });
    });

    it('decidir uma sugestão ainda PENDING é 409 e não altera o chamado', async () => {
      const id = await openTicket();
      const res = await http()
        .post(`/tickets/${id}/triage/accept`)
        .set('Authorization', `Bearer ${atendente}`);
      expect(res.status).toBe(409);
      expect((await ctx.prisma.ticket.findUniqueOrThrow({ where: { id } })).priority).toBe('MEDIA');
    });

    it('cliente não vê nem decide a triagem (403)', async () => {
      const id = await suggestedTicket();
      expect(
        (await http().get(`/tickets/${id}/triage`).set('Authorization', `Bearer ${cliente}`))
          .status,
      ).toBe(403);
      expect(
        (await http().get('/admin/queues/failed').set('Authorization', `Bearer ${atendente}`))
          .status,
      ).toBe(403);
    });
  });

  it('/health responde 200 com banco e Redis no ar', async () => {
    const res = await http().get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', checks: { database: 'up', redis: 'up' } });
  });
});
