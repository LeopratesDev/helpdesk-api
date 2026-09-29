import { TicketStatus } from '@prisma/client';

/**
 * Máquina de estados do chamado: para cada status, os próximos permitidos.
 *
 *   ABERTO → EM_ATENDIMENTO ⇄ AGUARDANDO_CLIENTE
 *                  ↓                 ↓
 *              RESOLVIDO ←───────────┘
 *              ↓       ↑ (reabrir → EM_ATENDIMENTO)
 *           FECHADO (final)
 */
export const ALLOWED_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  ABERTO: ['EM_ATENDIMENTO'],
  EM_ATENDIMENTO: ['AGUARDANDO_CLIENTE', 'RESOLVIDO'],
  AGUARDANDO_CLIENTE: ['EM_ATENDIMENTO', 'RESOLVIDO'],
  RESOLVIDO: ['FECHADO', 'EM_ATENDIMENTO'],
  FECHADO: [],
};

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Campos de data que mudam junto com a transição. */
export interface TransitionEffects {
  firstResponseAt?: Date;
  resolvedAt?: Date | null;
  closedAt?: Date;
}

/**
 * Efeitos colaterais de uma transição válida (função pura: recebe "agora").
 * - Primeira vez em atendimento = primeira resposta (usado no SLA).
 * - Reabrir um chamado resolvido limpa resolvedAt.
 */
export function transitionEffects(
  from: TicketStatus,
  to: TicketStatus,
  hasFirstResponse: boolean,
  now: Date,
): TransitionEffects {
  const effects: TransitionEffects = {};
  if (to === 'EM_ATENDIMENTO' && !hasFirstResponse) effects.firstResponseAt = now;
  if (to === 'RESOLVIDO') effects.resolvedAt = now;
  if (from === 'RESOLVIDO' && to === 'EM_ATENDIMENTO') effects.resolvedAt = null;
  if (to === 'FECHADO') effects.closedAt = now;
  return effects;
}
