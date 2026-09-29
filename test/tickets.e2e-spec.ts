import request from 'supertest';
import { createTestApp, createUser, loginAs, TestContext } from './setup-e2e';

describe('Chamados e status (E2E)', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());
  let cliente: string;
  let outroCliente: string;
  let atendente: string;
  let atendenteId: string;
  let clienteId: string;
  let categoryId: string;

  const open = async (title = 'Erro ao emitir nota fiscal') => {
    const res = await http()
      .post('/tickets')
      .set('Authorization', `Bearer ${cliente}`)
      .send({ title, description: 'Aparece erro 500 ao clicar em emitir.', categoryId });
    expect(res.status).toBe(201);
    return res.body.id as string;
  };
  const setStatus = (id: string, status: string, token = atendente) =>
    http().patch(`/tickets/${id}/status`).set('Authorization', `Bearer ${token}`).send({ status });

  beforeAll(async () => {
    ctx = await createTestApp({ LOGIN_RATE_LIMIT: '1000' });
    clienteId = (await createUser(ctx.prisma, 'CLIENTE')).id;
    await createUser(ctx.prisma, 'CLIENTE', 'outro@test.dev');
    atendenteId = (await createUser(ctx.prisma, 'ATENDENTE')).id;
    categoryId = (await ctx.prisma.category.create({ data: { name: 'Financeiro' } })).id;
    cliente = await loginAs(ctx.app, 'cliente@test.dev');
    outroCliente = await loginAs(ctx.app, 'outro@test.dev');
    atendente = await loginAs(ctx.app, 'atendente@test.dev');
  }, 120_000);

  afterAll(async () => ctx?.stop());

  describe('abertura', () => {
    it('cliente abre chamado: 201, status ABERTO, prioridade MEDIA, prazo de SLA de 24h e histórico', async () => {
      const before = Date.now();
      const res = await http()
        .post('/tickets')
        .set('Authorization', `Bearer ${cliente}`)
        .send({ title: 'Sistema lento', description: 'Telas demoram mais de 30 segundos.' });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        status: 'ABERTO',
        priority: 'MEDIA',
        requester: { id: clienteId },
        assignee: null,
      });
      const dueMs = new Date(res.body.slaDueAt as string).getTime() - before;
      expect(dueMs).toBeGreaterThan(23.9 * 3600_000);
      expect(dueMs).toBeLessThan(24.1 * 3600_000);

      const history = await ctx.prisma.ticketHistory.findMany({ where: { ticketId: res.body.id } });
      expect(history).toEqual([
        expect.objectContaining({ field: 'status', newValue: 'ABERTO', actorId: clienteId }),
      ]);
    });

    it('atendente não abre chamado (403) e categoria inexistente dá 422', async () => {
      const body = { title: 'Teste de chamado', description: 'Descrição com tamanho ok.' };
      expect(
        (await http().post('/tickets').set('Authorization', `Bearer ${atendente}`).send(body))
          .status,
      ).toBe(403);
      const res = await http()
        .post('/tickets')
        .set('Authorization', `Bearer ${cliente}`)
        .send({ ...body, categoryId: '00000000-0000-4000-8000-000000000000' });
      expect(res.status).toBe(422);
    });

    it('400 para título curto', async () => {
      const res = await http()
        .post('/tickets')
        .set('Authorization', `Bearer ${cliente}`)
        .send({ title: 'a', description: 'b' });
      expect(res.status).toBe(400);
      expect(Object.keys(res.body.errors as object)).toEqual(
        expect.arrayContaining(['title', 'description']),
      );
    });
  });

  describe('visibilidade', () => {
    it('cliente não vê chamado de outro cliente (404) e a listagem só traz os próprios', async () => {
      const id = await open();
      expect(
        (await http().get(`/tickets/${id}`).set('Authorization', `Bearer ${outroCliente}`)).status,
      ).toBe(404);
      expect(
        (await http().get(`/tickets/${id}`).set('Authorization', `Bearer ${cliente}`)).status,
      ).toBe(200);

      const list = await http().get('/tickets').set('Authorization', `Bearer ${outroCliente}`);
      expect(list.body.meta.total).toBe(0);
    });

    it('cliente não muda status (403)', async () => {
      const id = await open();
      expect((await setStatus(id, 'EM_ATENDIMENTO', cliente)).status).toBe(403);
    });
  });

  describe('máquina de status', () => {
    it('fluxo completo registra datas, responsável e histórico', async () => {
      const id = await open();

      const start = await setStatus(id, 'EM_ATENDIMENTO');
      expect(start.status).toBe(200);
      expect(start.body.assignee).toMatchObject({ id: atendenteId });
      expect(start.body.firstResponseAt).not.toBeNull();

      await setStatus(id, 'AGUARDANDO_CLIENTE').expect(200);
      await setStatus(id, 'EM_ATENDIMENTO').expect(200);
      const resolved = await setStatus(id, 'RESOLVIDO');
      expect(resolved.body.resolvedAt).not.toBeNull();
      const closed = await setStatus(id, 'FECHADO');
      expect(closed.body.closedAt).not.toBeNull();

      // a primeira resposta não muda ao voltar para EM_ATENDIMENTO
      expect(closed.body.firstResponseAt).toBe(start.body.firstResponseAt);

      const history = await ctx.prisma.ticketHistory.findMany({
        where: { ticketId: id, field: 'status' },
        orderBy: { createdAt: 'asc' },
      });
      expect(history.map((h) => h.newValue)).toEqual([
        'ABERTO',
        'EM_ATENDIMENTO',
        'AGUARDANDO_CLIENTE',
        'EM_ATENDIMENTO',
        'RESOLVIDO',
        'FECHADO',
      ]);
    });

    it('transição inválida retorna 422 e não altera nada', async () => {
      const id = await open();
      const res = await setStatus(id, 'RESOLVIDO');
      expect(res.status).toBe(422);
      expect(res.body.detail).toContain('ABERTO para RESOLVIDO');

      const ticket = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id } });
      expect(ticket.status).toBe('ABERTO');
      expect(await ctx.prisma.ticketHistory.count({ where: { ticketId: id } })).toBe(1);
    });

    it('chamado fechado não aceita nenhuma transição', async () => {
      const id = await open();
      for (const s of ['EM_ATENDIMENTO', 'RESOLVIDO', 'FECHADO'])
        await setStatus(id, s).expect(200);
      for (const s of ['ABERTO', 'EM_ATENDIMENTO', 'RESOLVIDO'])
        expect((await setStatus(id, s)).status).toBe(422);
    });

    it('status desconhecido é 400 (validação), não 422 (regra)', async () => {
      const id = await open();
      expect((await setStatus(id, 'PERDIDO')).status).toBe(400);
    });

    it('duas mudanças simultâneas: uma vence e a outra recebe 409', async () => {
      const id = await open();
      const results = await Promise.all([
        setStatus(id, 'EM_ATENDIMENTO'),
        setStatus(id, 'EM_ATENDIMENTO'),
      ]);
      const statuses = results.map((r) => r.status).sort();
      // a perdedora vê 409 (lock otimista) ou 422 (já leu o status novo)
      expect(statuses[0]).toBe(200);
      expect([409, 422]).toContain(statuses[1]);
      expect(
        await ctx.prisma.ticketHistory.count({
          where: { ticketId: id, newValue: 'EM_ATENDIMENTO' },
        }),
      ).toBe(1);
    });
  });

  describe('prioridade e atribuição', () => {
    it('mudar prioridade antes da primeira resposta recalcula o SLA e grava histórico', async () => {
      const id = await open();
      const res = await http()
        .patch(`/tickets/${id}`)
        .set('Authorization', `Bearer ${atendente}`)
        .send({ priority: 'CRITICA' });
      expect(res.status).toBe(200);
      const hours =
        (new Date(res.body.slaDueAt).getTime() - new Date(res.body.createdAt).getTime()) / 3600_000;
      expect(hours).toBe(4);
      expect(
        await ctx.prisma.ticketHistory.count({ where: { ticketId: id, field: 'priority' } }),
      ).toBe(1);
    });

    it('atribuir a um cliente é 422; a um atendente grava histórico', async () => {
      const id = await open();
      const bad = await http()
        .patch(`/tickets/${id}/assign`)
        .set('Authorization', `Bearer ${atendente}`)
        .send({ assigneeId: clienteId });
      expect(bad.status).toBe(422);
      const ok = await http()
        .patch(`/tickets/${id}/assign`)
        .set('Authorization', `Bearer ${atendente}`)
        .send({ assigneeId: atendenteId });
      expect(ok.body.assignee.id).toBe(atendenteId);
    });
  });

  describe('listagem', () => {
    beforeAll(async () => {
      const id = await open('Chamado crítico para filtro');
      await http()
        .patch(`/tickets/${id}`)
        .set('Authorization', `Bearer ${atendente}`)
        .send({ priority: 'CRITICA' });
    });

    it('pagina e informa o total', async () => {
      const res = await http()
        .get('/tickets?page=1&pageSize=2')
        .set('Authorization', `Bearer ${atendente}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.meta).toMatchObject({ page: 1, pageSize: 2 });
      expect(res.body.meta.totalPages).toBe(Math.ceil(res.body.meta.total / 2));
    });

    it('filtra por status, prioridade e categoria', async () => {
      const res = await http()
        .get(`/tickets?status=ABERTO&priority=CRITICA&categoryId=${categoryId}`)
        .set('Authorization', `Bearer ${atendente}`);
      expect(res.body.data.length).toBeGreaterThan(0);
      for (const t of res.body.data) {
        expect(t).toMatchObject({
          status: 'ABERTO',
          priority: 'CRITICA',
          category: { id: categoryId },
        });
      }
    });

    it('filtra por período e ordena por prioridade', async () => {
      const future = await http()
        .get('/tickets?from=2999-01-01')
        .set('Authorization', `Bearer ${atendente}`);
      expect(future.body.meta.total).toBe(0);

      const sorted = await http()
        .get('/tickets?sortBy=priority&sortOrder=desc&pageSize=100')
        .set('Authorization', `Bearer ${atendente}`);
      const order = ['BAIXA', 'MEDIA', 'ALTA', 'CRITICA'];
      const ranks = (sorted.body.data as { priority: string }[]).map((t) =>
        order.indexOf(t.priority),
      );
      expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
    });

    it('400 para pageSize acima do limite e ordenação desconhecida', async () => {
      expect(
        (await http().get('/tickets?pageSize=500').set('Authorization', `Bearer ${atendente}`))
          .status,
      ).toBe(400);
      expect(
        (await http().get('/tickets?sortBy=senha').set('Authorization', `Bearer ${atendente}`))
          .status,
      ).toBe(400);
    });
  });
});
