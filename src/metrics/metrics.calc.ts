/** Percentual com 1 casa decimal; null quando não há base (evita divisão por zero e "0%" enganoso). */
export function percent(part: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((part / total) * 1000) / 10;
}

/** Converte segundos (média do banco) em minutos inteiros; null se não houver dado. */
export function secondsToMinutes(seconds: number | null): number | null {
  return seconds === null ? null : Math.round(seconds / 60);
}

/**
 * % dentro do SLA: só entram chamados com resultado definido —
 * já respondidos (no prazo ou não) ou já estourados sem resposta.
 * Um chamado aberto ainda dentro do prazo não conta nem a favor nem contra.
 */
export function slaCompliance(evaluated: number, breached: number): number | null {
  return percent(evaluated - breached, evaluated);
}

/** Taxa de acerto da IA = sugestões aceitas sem correção / sugestões decididas. */
export function aiAccuracy(accepted: number, corrected: number): number | null {
  return percent(accepted, accepted + corrected);
}
