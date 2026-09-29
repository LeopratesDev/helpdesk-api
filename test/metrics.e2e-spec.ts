import { Prisma, TicketStatus, TriageStatus } from '@prisma/client';
import request from 'supertest';
import { createTestApp, createUser, loginAs, TestContext } from './setup-e2e';

const T0 = new Date('2026-01-01T00:00:00Z');
const h = (hours: number) => new Date(T0.getTime() + hours * 3_600_000);

describe('Métricas (E2E)', () => {
  let ctx: TestContext;
  let atendente: string;
  const http = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp({ LOGIN_RATE_LIMIT: '1000' });
    const requesterId = (await createUser(ctx.prisma, 'CLIENTE')).id;
    await createUser(ctx.prisma, 'ATENDENTE');
    atendente = await loginAs(ctx.app, 'atendente@test.dev');

    /**
     * Cenário calculado à mão:
     *   A: fechado,   1ª resposta 1h, resolvido 5h, no prazo   → IA aceita
     *   B: resolvido, 1ª resposta 3h, resolvido 7h, estourou   → IA aceita
     *   C: em atend., 1ª resposta 2h,               no prazo   → IA corrigida
     *   D: aberto, sem resposta, prazo vencido (estourou)      → sugestão pendente
     *   E: aberto, sem resposta, ainda no prazo (não avaliado) → triagem falhou
     */
    const rows: [TicketStatus, Partial<Prisma.TicketUncheckedCreateInput>, TriageStatus][] = [
      ['FECHADO', { firstResponseAt: h(1), resolvedAt: h(5) }, 'ACCEPTED'],
      ['RESOLVIDO', { firstResponseAt: h(3), resolvedAt: h(7), slaBreached: true }, 'ACCEPTED'],
      ['EM_ATENDIMENTO', { firstResponseAt: h(2) }, 'CORRECTED'],
      ['ABERTO', { slaBreached: true }, 'SUGGESTED'],
      ['ABERTO', {}, 'FAILED'],
    ];
    for (const [status, extra, triage] of rows) {
      await ctx.prisma.ticket.create({
        data: {
          title: 't',
          description: 'd',
          status,
          requesterId,
          createdAt: T0,
          slaDueAt: h(4),
          ...extra,
          triage: { create: { status: triage } },
        },
      });
    }
  }, 180_000);

  afterAll(async () => ctx?.stop());

  it('calcula contagens, médias, SLA e acerto da IA', async () => {
    const res = await http().get('/metrics/overview').set('Authorization', `Bearer ${atendente}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      totalTickets: 5,
      ticketsByStatus: {
        ABERTO: 2,
        EM_ATENDIMENTO: 1,
        AGUARDANDO_CLIENTE: 0,
        RESOLVIDO: 1,
        FECHADO: 1,
      },
      avgFirstResponseMinutes: 120, // (1h + 3h + 2h) / 3
      avgResolutionMinutes: 360, // (5h + 7h) / 2
      slaCompliancePercent: 50, // avaliados A,B,C,D; estourados B,D
      aiAccuracyPercent: 66.7, // 2 aceitas / (2 aceitas + 1 corrigida)
      aiSuggestions: { accepted: 2, corrected: 1, pending: 1, failed: 1 },
    });
  });

  it('período sem chamados devolve zeros e null (nunca divide por zero)', async () => {
    const res = await http()
      .get('/metrics/overview?from=2030-01-01')
      .set('Authorization', `Bearer ${atendente}`);

    expect(res.body).toMatchObject({
      totalTickets: 0,
      avgFirstResponseMinutes: null,
      avgResolutionMinutes: null,
      slaCompliancePercent: null,
      aiAccuracyPercent: null,
    });
  });

  it('filtra pelo período de abertura', async () => {
    const res = await http()
      .get('/metrics/overview?from=2025-12-31&to=2026-01-02')
      .set('Authorization', `Bearer ${atendente}`);
    expect(res.body.totalTickets).toBe(5);
  });

  it('cliente não vê métricas (403) e data inválida é 400', async () => {
    const cliente = await loginAs(ctx.app, 'cliente@test.dev');
    expect(
      (await http().get('/metrics/overview').set('Authorization', `Bearer ${cliente}`)).status,
    ).toBe(403);
    expect(
      (await http().get('/metrics/overview?from=ontem').set('Authorization', `Bearer ${atendente}`))
        .status,
    ).toBe(400);
  });
});
