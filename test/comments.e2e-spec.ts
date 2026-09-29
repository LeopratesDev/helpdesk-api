import request from 'supertest';
import { createTestApp, createUser, loginAs, TestContext } from './setup-e2e';

describe('Comentários e auditoria (E2E)', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());
  let cliente: string;
  let outroCliente: string;
  let atendente: string;
  let atendenteId: string;

  const open = async () => {
    const res = await http()
      .post('/tickets')
      .set('Authorization', `Bearer ${cliente}`)
      .send({ title: 'Impressora não imprime', description: 'Desde ontem não sai nenhuma folha.' });
    return res.body.id as string;
  };
  const comment = (id: string, token: string, body: object) =>
    http().post(`/tickets/${id}/comments`).set('Authorization', `Bearer ${token}`).send(body);

  beforeAll(async () => {
    ctx = await createTestApp({ LOGIN_RATE_LIMIT: '1000' });
    await createUser(ctx.prisma, 'CLIENTE');
    await createUser(ctx.prisma, 'CLIENTE', 'outro@test.dev');
    atendenteId = (await createUser(ctx.prisma, 'ATENDENTE')).id;
    cliente = await loginAs(ctx.app, 'cliente@test.dev');
    outroCliente = await loginAs(ctx.app, 'outro@test.dev');
    atendente = await loginAs(ctx.app, 'atendente@test.dev');
  }, 120_000);

  afterAll(async () => ctx?.stop());

  it('cliente comenta no próprio chamado; outro cliente recebe 404', async () => {
    const id = await open();
    const res = await comment(id, cliente, { body: 'Segue mais informação.' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ internal: false, author: { name: 'CLIENTE' } });
    expect((await comment(id, outroCliente, { body: 'oi' })).status).toBe(404);
  });

  it('cliente não cria comentário interno (403)', async () => {
    const id = await open();
    expect((await comment(id, cliente, { body: 'x', internal: true })).status).toBe(403);
  });

  it('cliente não vê comentários internos; a equipe vê todos', async () => {
    const id = await open();
    await comment(id, atendente, { body: 'Resposta ao cliente' }).expect(201);
    await comment(id, atendente, { body: 'Nota interna: cliente VIP', internal: true }).expect(201);

    const doCliente = await http()
      .get(`/tickets/${id}/comments`)
      .set('Authorization', `Bearer ${cliente}`);
    expect((doCliente.body as { body: string }[]).map((c) => c.body)).toEqual([
      'Resposta ao cliente',
    ]);

    const daEquipe = await http()
      .get(`/tickets/${id}/comments`)
      .set('Authorization', `Bearer ${atendente}`);
    expect(daEquipe.body).toHaveLength(2);
  });

  it('primeira resposta pública da equipe marca firstResponseAt; interna não marca', async () => {
    const id = await open();
    await comment(id, atendente, { body: 'nota', internal: true }).expect(201);
    expect(
      (await ctx.prisma.ticket.findUniqueOrThrow({ where: { id } })).firstResponseAt,
    ).toBeNull();

    const first = await comment(id, atendente, { body: 'Olá, estamos verificando.' });
    const ticket = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id } });
    expect(ticket.firstResponseAt?.toISOString()).toBe(first.body.createdAt);

    await comment(id, atendente, { body: 'Segunda resposta' }).expect(201);
    const again = await ctx.prisma.ticket.findUniqueOrThrow({ where: { id } });
    expect(again.firstResponseAt).toEqual(ticket.firstResponseAt);
  });

  it('comentário do cliente não conta como primeira resposta', async () => {
    const id = await open();
    await comment(id, cliente, { body: 'Alguém?' }).expect(201);
    expect(
      (await ctx.prisma.ticket.findUniqueOrThrow({ where: { id } })).firstResponseAt,
    ).toBeNull();
  });

  it('chamado fechado não aceita comentário (422)', async () => {
    const id = await open();
    for (const status of ['EM_ATENDIMENTO', 'RESOLVIDO', 'FECHADO']) {
      await http()
        .patch(`/tickets/${id}/status`)
        .set('Authorization', `Bearer ${atendente}`)
        .send({ status })
        .expect(200);
    }
    expect((await comment(id, atendente, { body: 'tarde demais' })).status).toBe(422);
  });

  it('histórico registra abertura, comentários e mudanças com autor, em ordem', async () => {
    const id = await open();
    await comment(id, atendente, { body: 'Olá' }).expect(201);
    await http()
      .patch(`/tickets/${id}/status`)
      .set('Authorization', `Bearer ${atendente}`)
      .send({ status: 'EM_ATENDIMENTO' })
      .expect(200);

    const res = await http()
      .get(`/tickets/${id}/history`)
      .set('Authorization', `Bearer ${atendente}`);
    expect(res.status).toBe(200);
    expect((res.body as { field: string }[]).map((h) => h.field)).toEqual([
      'status',
      'comment',
      'firstResponseAt',
      'status',
      'assigneeId',
    ]);
    expect(res.body[3]).toMatchObject({
      oldValue: 'ABERTO',
      newValue: 'EM_ATENDIMENTO',
      actor: { id: atendenteId },
    });
  });

  it('cliente não acessa o histórico (403)', async () => {
    const id = await open();
    expect(
      (await http().get(`/tickets/${id}/history`).set('Authorization', `Bearer ${cliente}`)).status,
    ).toBe(403);
  });

  it('corpo vazio é 400', async () => {
    const id = await open();
    expect((await comment(id, atendente, { body: '' })).status).toBe(400);
  });
});
