import { Priority } from '@prisma/client';
import { z } from 'zod';

/**
 * Formato que pedimos ao LLM. Também é enviado à API como "structured output",
 * mas NÃO confiamos nisso: o helper do SDK transforma enum/min/max em texto de
 * descrição, então a API não os garante. Por isso validamos de novo aqui.
 */
export const triageOutputSchema = z.object({
  category: z.string().min(1).max(60),
  priority: z.enum([Priority.BAIXA, Priority.MEDIA, Priority.ALTA, Priority.CRITICA]),
  summary: z.string().min(3).max(140),
  confidence: z.number().min(0).max(1),
});

export type TriageOutput = z.infer<typeof triageOutputSchema>;

/** Saída do LLM que não passou na validação: vale tentar de novo (retry). */
export class InvalidLlmOutputError extends Error {
  constructor(public readonly issues: string) {
    super(`Resposta do LLM inválida: ${issues}`);
  }
}

/**
 * Valida a resposta crua do LLM antes de gravar qualquer coisa.
 * Além do formato, a categoria precisa ser uma das categorias ativas do sistema.
 */
export function parseTriageOutput(raw: unknown, allowedCategories: string[]): TriageOutput {
  const result = triageOutputSchema.safeParse(raw);
  if (!result.success) {
    throw new InvalidLlmOutputError(
      result.error.issues.map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`).join('; '),
    );
  }
  const match = allowedCategories.find(
    (c) => c.toLowerCase() === result.data.category.trim().toLowerCase(),
  );
  if (!match) {
    throw new InvalidLlmOutputError(`category: "${result.data.category}" não existe`);
  }
  return { ...result.data, category: match };
}
