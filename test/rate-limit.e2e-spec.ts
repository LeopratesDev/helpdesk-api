import request from 'supertest';
import { createTestApp, TestContext } from './setup-e2e';

// Suíte separada: o limite baixo não interfere nos logins das outras suítes
describe('Rate limit no login (E2E)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp({ LOGIN_RATE_LIMIT: '3' });
  }, 120_000);

  afterAll(async () => ctx?.stop());

  it('bloqueia com 429 após 3 tentativas no mesmo minuto', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await request(ctx.app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'x@test.dev', password: 'x' });
      statuses.push(res.status);
    }
    expect(statuses).toEqual([401, 401, 401, 429]);
  });

  it('outras rotas não são afetadas pelo limite de login', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/auth/me');
    expect(res.status).toBe(401);
  });
});
