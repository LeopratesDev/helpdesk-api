import { Priority } from '@prisma/client';

/** Horas para a primeira resposta, por prioridade. */
export const SLA_FIRST_RESPONSE_HOURS: Record<Priority, number> = {
  CRITICA: 4,
  ALTA: 8,
  MEDIA: 24,
  BAIXA: 48,
};

const HOUR_MS = 60 * 60 * 1000;

export function computeSlaDueAt(priority: Priority, openedAt: Date): Date {
  return new Date(openedAt.getTime() + SLA_FIRST_RESPONSE_HOURS[priority] * HOUR_MS);
}
