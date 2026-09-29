/** Token de injeção: o worker depende da interface, não da implementação. */
export const LLM_CLIENT = Symbol('LLM_CLIENT');

export interface TriageInput {
  title: string;
  description: string;
  categories: string[];
}

export interface LlmTriageResult {
  /** JSON devolvido pelo modelo, ainda NÃO validado. */
  raw: unknown;
  /** Modelo que respondeu (ou "fake"). */
  model: string;
}

/**
 * Contrato do cliente de LLM. Duas implementações:
 * - AnthropicLlmClient: chama a API do Claude;
 * - FakeLlmClient: regras por palavra-chave, sem rede e sem custo.
 * Nos testes, uma terceira (mock) é injetada no lugar.
 */
export interface LlmClient {
  triage(input: TriageInput): Promise<LlmTriageResult>;
}

/** Erro que não adianta repetir (ex.: chave inválida, requisição malformada). */
export class NonRetryableLlmError extends Error {}
