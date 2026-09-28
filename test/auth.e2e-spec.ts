import request from 'supertest';
import { createTestApp, createUser, loginAs, PASSWORD, TestContext } from './setup-e2e';

describe('Auth, papéis e erros (E2E)', () => {
  let ctx: TestContext;
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp({ LOGIN_RATE_LIMIT: '1000' });
    await createUser(ctx.prisma, 'ADMIN');
    await createUser(ctx.prisma, 'ATENDENTE');
    await createUser(ctx.prisma, 'CLIENTE');
  }, 120_000);

  afterAll(async () => ctx?.stop());

  describe('login', () => {
    it('retorna access e refresh token com credenciais válidas', async () => {
      const res = await http()
        .post('/auth/login')
        .send({ email: 'admin@test.dev', password: PASSWORD });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
        expiresIn: 900,
      });
    });

    it('401 em ProblemDetails com senha errada, sem revelar se o e-mail existe', async () => {
      const wrongPass = await http()
        .post('/auth/login')
        .send({ email: 'admin@test.dev', password: 'x' });
      const noUser = await http()
        .post('/auth/login')
        .send({ email: 'ninguem@test.dev', password: 'x' });
      expect(wrongPass.status).toBe(401);
      expect(wrongPass.headers['content-type']).toContain('application/problem+json');
      expect(wrongPass.body).toMatchObject({
        status: 401,
        title: 'Não autenticado',
        instance: '/auth/login',
      });
      expect(noUser.body.detail).toBe(wrongPass.body.detail);
    });

    it('400 com erros por campo quando o corpo é inválido', async () => {
      const res = await http().post('/auth/login').send({ email: 'nao-e-email' });
      expect(res.status).toBe(400);
      expect(res.body.errors).toHaveProperty('email');
      expect(res.body.errors).toHaveProperty('password');
    });
  });

  describe('refresh token', () => {
    it('rotaciona: o token antigo não vale mais e o reuso encerra todas as sessões', async () => {
      const login = await http()
        .post('/auth/login')
        .send({ email: 'cliente@test.dev', password: PASSWORD });
      const first = login.body.refreshToken as string;

      const refreshed = await http().post('/auth/refresh').send({ refreshToken: first });
      expect(refreshed.status).toBe(200);
      const second = refreshed.body.refreshToken as string;
      expect(second).not.toBe(first);

      // reuso do token antigo → 401 e o novo também é revogado
      expect((await http().post('/auth/refresh').send({ refreshToken: first })).status).toBe(401);
      expect((await http().post('/auth/refresh').send({ refreshToken: second })).status).toBe(401);
    });

    it('logout revoga o refresh token', async () => {
      const login = await http()
        .post('/auth/login')
        .send({ email: 'cliente@test.dev', password: PASSWORD });
      const token = login.body.refreshToken as string;
      expect((await http().post('/auth/logout').send({ refreshToken: token })).status).toBe(204);
      expect((await http().post('/auth/refresh').send({ refreshToken: token })).status).toBe(401);
    });

    it('não guarda o refresh token em texto puro no banco', async () => {
      const login = await http()
        .post('/auth/login')
        .send({ email: 'admin@test.dev', password: PASSWORD });
      const found = await ctx.prisma.refreshToken.findFirst({
        where: { tokenHash: login.body.refreshToken },
      });
      expect(found).toBeNull();
    });
  });

  describe('autorização', () => {
    it('401 sem token e com token inválido', async () => {
      expect((await http().get('/auth/me')).status).toBe(401);
      expect((await http().get('/auth/me').set('Authorization', 'Bearer abc')).status).toBe(401);
    });

    it('/auth/me retorna o usuário sem passwordHash', async () => {
      const token = await loginAs(ctx.app, 'atendente@test.dev');
      const res = await http().get('/auth/me').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ email: 'atendente@test.dev', role: 'ATENDENTE' });
      expect(res.body).not.toHaveProperty('passwordHash');
    });

    it('403 quando o papel não tem permissão', async () => {
      const token = await loginAs(ctx.app, 'cliente@test.dev');
      const res = await http().get('/users').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
      expect(res.body.title).toBe('Acesso negado');
    });
  });

  describe('usuários e categorias (Admin)', () => {
    let admin: string;
    beforeAll(async () => {
      admin = await loginAs(ctx.app, 'admin@test.dev');
    });

    it('cria usuário, bloqueia e-mail duplicado (409) e campo extra (400)', async () => {
      const body = {
        name: 'Nova',
        email: 'nova@test.dev',
        password: 'Senha1234',
        role: 'ATENDENTE',
      };
      const created = await http()
        .post('/users')
        .set('Authorization', `Bearer ${admin}`)
        .send(body);
      expect(created.status).toBe(201);
      expect(created.body).not.toHaveProperty('passwordHash');

      const dup = await http().post('/users').set('Authorization', `Bearer ${admin}`).send(body);
      expect(dup.status).toBe(409);

      const extra = await http()
        .post('/users')
        .set('Authorization', `Bearer ${admin}`)
        .send({ ...body, email: 'x@test.dev', hacker: true });
      expect(extra.status).toBe(400);
    });

    it('usuário desativado não consegue logar', async () => {
      const user = await createUser(ctx.prisma, 'CLIENTE', 'inativo@test.dev');
      await http()
        .patch(`/users/${user.id}`)
        .set('Authorization', `Bearer ${admin}`)
        .send({ active: false })
        .expect(200);
      const res = await http()
        .post('/auth/login')
        .send({ email: 'inativo@test.dev', password: PASSWORD });
      expect(res.status).toBe(401);
    });

    it('404 para usuário inexistente e 400 para id malformado', async () => {
      const missing = await http()
        .get('/users/00000000-0000-4000-8000-000000000000')
        .set('Authorization', `Bearer ${admin}`);
      expect(missing.status).toBe(404);
      expect((await http().get('/users/abc').set('Authorization', `Bearer ${admin}`)).status).toBe(
        400,
      );
    });

    it('categorias: Admin cria, nome duplicado dá 409, qualquer logado lista', async () => {
      await http()
        .post('/categories')
        .set('Authorization', `Bearer ${admin}`)
        .send({ name: 'Rede' })
        .expect(201);
      const dup = await http()
        .post('/categories')
        .set('Authorization', `Bearer ${admin}`)
        .send({ name: 'Rede' });
      expect(dup.status).toBe(409);

      const client = await loginAs(ctx.app, 'cliente@test.dev');
      const list = await http().get('/categories').set('Authorization', `Bearer ${client}`);
      expect(list.status).toBe(200);
      expect(list.body).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'Rede' })]),
      );
      expect(
        (
          await http()
            .post('/categories')
            .set('Authorization', `Bearer ${client}`)
            .send({ name: 'X' })
        ).status,
      ).toBe(403);
    });
  });

  describe('observabilidade e segurança', () => {
    it('devolve x-request-id (gerado ou repassado) e headers do Helmet', async () => {
      const generated = await http().get('/categories');
      expect(generated.headers['x-request-id']).toMatch(/[0-9a-f-]{36}/);
      expect(generated.headers['x-content-type-options']).toBe('nosniff');

      const forwarded = await http().get('/categories').set('x-request-id', 'abc-123');
      expect(forwarded.headers['x-request-id']).toBe('abc-123');
    });
  });
});
