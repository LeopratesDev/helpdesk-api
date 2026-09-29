import { Priority } from '@prisma/client';
import { LlmClient, LlmTriageResult, TriageInput } from './llm-client';

const CATEGORY_RULES: [RegExp, string][] = [
  [/senha|login|acesso|bloquead|autentica/i, 'Acesso e login'],
  [/boleto|cobran|fatura|nota fiscal|pagamento|reembolso/i, 'Financeiro'],
  [/webhook|api|integra|sincroniza|erp/i, 'Integração'],
  [/impressora|leitor|notebook|computador|monitor|hardware/i, 'Hardware'],
  [/erro|bug|trava|falha|500|exception|não funciona/i, 'Bug no sistema'],
  [/como|onde|dúvida|duvida|ajuda/i, 'Dúvida de uso'],
];

const PRIORITY_RULES: [RegExp, Priority][] = [
  [/urgente|parad[oa]|fora do ar|todos os usu|produção|crític/i, 'CRITICA'],
  [/erro|não consigo|bloquead|falha|cobrança duplicada/i, 'ALTA'],
  [/dúvida|duvida|como|sugest/i, 'BAIXA'],
];

/**
 * Modo fake: usado quando ANTHROPIC_API_KEY não está definida.
 * Determinístico (mesma entrada → mesma saída), sem rede e sem custo,
 * para qualquer pessoa rodar o projeto e ver o fluxo completo da fila.
 */
export class FakeLlmClient implements LlmClient {
  triage(input: TriageInput): Promise<LlmTriageResult> {
    const text = `${input.title}\n${input.description}`;
    const guessed = CATEGORY_RULES.find(([re]) => re.test(text))?.[1];
    const category = input.categories.find((c) => c === guessed) ?? input.categories[0] ?? 'Geral';
    const priority = PRIORITY_RULES.find(([re]) => re.test(text))?.[1] ?? 'MEDIA';
    const summary = input.title.length > 100 ? `${input.title.slice(0, 97)}...` : input.title;

    return Promise.resolve({
      raw: { category, priority, summary, confidence: guessed ? 0.7 : 0.4 },
      model: 'fake',
    });
  }
}
