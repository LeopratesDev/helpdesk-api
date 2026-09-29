export const TRIAGE_QUEUE = 'triage';
export const SLA_QUEUE = 'sla';

export interface TriageJobData {
  ticketId: string;
}

/**
 * jobId determinístico: o BullMQ ignora um add() com um id que já existe na fila.
 * Publicar duas vezes o mesmo chamado não gera dois jobs (1ª camada de idempotência).
 * (O BullMQ não aceita ":" em ids customizados, por isso o hífen.)
 */
export const triageJobId = (ticketId: string) => `triage-${ticketId}`;
