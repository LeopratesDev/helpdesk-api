import { TicketStatus } from '@prisma/client';
import { ALLOWED_TRANSITIONS, canTransition, transitionEffects } from './ticket-status';

const ALL: TicketStatus[] = [
  'ABERTO',
  'EM_ATENDIMENTO',
  'AGUARDANDO_CLIENTE',
  'RESOLVIDO',
  'FECHADO',
];

const VALID: [TicketStatus, TicketStatus][] = [
  ['ABERTO', 'EM_ATENDIMENTO'],
  ['EM_ATENDIMENTO', 'AGUARDANDO_CLIENTE'],
  ['EM_ATENDIMENTO', 'RESOLVIDO'],
  ['AGUARDANDO_CLIENTE', 'EM_ATENDIMENTO'],
  ['AGUARDANDO_CLIENTE', 'RESOLVIDO'],
  ['RESOLVIDO', 'FECHADO'],
  ['RESOLVIDO', 'EM_ATENDIMENTO'],
];
const isValid = (from: TicketStatus, to: TicketStatus) =>
  VALID.some(([f, t]) => f === from && t === to);

// Todas as 25 combinações: as 7 válidas passam, as outras 18 são proibidas
const ALL_PAIRS = ALL.flatMap((from) => ALL.map((to) => [from, to] as const));

describe('máquina de status do chamado', () => {
  it.each(ALL_PAIRS)('%s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(isValid(from, to));
  });

  it('FECHADO é estado final', () => {
    expect(ALLOWED_TRANSITIONS.FECHADO).toHaveLength(0);
  });

  it('não permite pular etapas (ABERTO → RESOLVIDO)', () => {
    expect(canTransition('ABERTO', 'RESOLVIDO')).toBe(false);
  });

  it('não permite transição para o mesmo status', () => {
    for (const s of ALL) expect(canTransition(s, s)).toBe(false);
  });
});

describe('transitionEffects', () => {
  const now = new Date('2026-01-10T12:00:00Z');

  it('marca a primeira resposta na primeira entrada em atendimento', () => {
    expect(transitionEffects('ABERTO', 'EM_ATENDIMENTO', false, now)).toEqual({
      firstResponseAt: now,
    });
  });

  it('não sobrescreve a primeira resposta quando já existe', () => {
    expect(transitionEffects('AGUARDANDO_CLIENTE', 'EM_ATENDIMENTO', true, now)).toEqual({});
  });

  it('registra resolvedAt e closedAt', () => {
    expect(transitionEffects('EM_ATENDIMENTO', 'RESOLVIDO', true, now)).toEqual({
      resolvedAt: now,
    });
    expect(transitionEffects('RESOLVIDO', 'FECHADO', true, now)).toEqual({ closedAt: now });
  });

  it('reabrir limpa resolvedAt', () => {
    expect(transitionEffects('RESOLVIDO', 'EM_ATENDIMENTO', true, now)).toEqual({
      resolvedAt: null,
    });
  });
});
