import { computeSlaDueAt, isSlaBreached } from './sla.policy';

describe('computeSlaDueAt', () => {
  const openedAt = new Date('2026-01-10T10:00:00Z');

  it.each([
    ['CRITICA', '2026-01-10T14:00:00.000Z'],
    ['ALTA', '2026-01-10T18:00:00.000Z'],
    ['MEDIA', '2026-01-11T10:00:00.000Z'],
    ['BAIXA', '2026-01-12T10:00:00.000Z'],
  ] as const)('prioridade %s vence em %s', (priority, expected) => {
    expect(computeSlaDueAt(priority, openedAt).toISOString()).toBe(expected);
  });

  it('não altera a data de abertura recebida', () => {
    const copy = new Date(openedAt);
    computeSlaDueAt('ALTA', copy);
    expect(copy.getTime()).toBe(openedAt.getTime());
  });
});

describe('isSlaBreached', () => {
  const due = new Date('2026-01-10T14:00:00Z');
  const before = new Date('2026-01-10T13:59:59Z');
  const after = new Date('2026-01-10T14:00:01Z');

  it('sem resposta e dentro do prazo: não estourou', () => {
    expect(isSlaBreached(due, null, before)).toBe(false);
  });

  it('sem resposta e prazo vencido: estourou', () => {
    expect(isSlaBreached(due, null, after)).toBe(true);
  });

  it('respondido no prazo continua dentro do SLA mesmo depois do vencimento', () => {
    expect(isSlaBreached(due, before, after)).toBe(false);
  });

  it('respondido depois do prazo: estourou', () => {
    expect(isSlaBreached(due, after, after)).toBe(true);
  });

  it('resposta exatamente no prazo não estoura', () => {
    expect(isSlaBreached(due, due, after)).toBe(false);
  });
});
