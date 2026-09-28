import { computeSlaDueAt } from './sla.policy';

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
