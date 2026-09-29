import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV } from '../config/config.module';
import { Env } from '../config/env.schema';
import { PrismaService } from '../prisma/prisma.service';
import { LLM_CLIENT, LlmClient } from './llm/llm-client';
import { parseTriageOutput } from './triage.schema';

export type TriageOutcome = 'suggested' | 'skipped';

export class LlmTimeoutError extends Error {}

/** Garante um teto de tempo para qualquer implementação de LlmClient. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new LlmTimeoutError(`LLM não respondeu em ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Regra do worker de triagem (sem nada de BullMQ aqui: testável isoladamente). */
@Injectable()
export class TriageService {
  private readonly logger = new Logger(TriageService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(LLM_CLIENT) private readonly llm: LlmClient,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Processa a triagem de um chamado. Idempotente:
   * - se a sugestão já saiu de PENDING (já sugerida, aceita, corrigida), não faz nada;
   * - a gravação é condicional (WHERE status = PENDING): se dois workers processarem
   *   o mesmo job ao mesmo tempo, só um grava; o outro vê count = 0 e sai.
   * Lança erro para o BullMQ tentar de novo (timeout, rede, saída inválida).
   */
  async process(ticketId: string, attempt: number): Promise<TriageOutcome> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { triage: true },
    });
    if (!ticket || (ticket.triage && ticket.triage.status !== 'PENDING')) return 'skipped';

    const categories = (
      await this.prisma.category.findMany({ where: { active: true }, orderBy: { name: 'asc' } })
    ).map((c) => c.name);

    const inputText = `${ticket.title}\n\n${ticket.description}`;
    await this.prisma.triageSuggestion.upsert({
      where: { ticketId },
      create: { ticketId, attempts: attempt, inputText },
      update: { attempts: attempt, inputText },
    });

    const { raw, model } = await withTimeout(
      this.llm.triage({ title: ticket.title, description: ticket.description, categories }),
      this.env.LLM_TIMEOUT_MS,
    );
    // Nada é gravado se a validação falhar
    const output = parseTriageOutput(raw, categories);

    const saved = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.triageSuggestion.updateMany({
        where: { ticketId, status: 'PENDING' },
        data: {
          status: 'SUGGESTED',
          suggestedCategory: output.category,
          suggestedPriority: output.priority,
          summary: output.summary,
          confidence: output.confidence,
          model,
          error: null,
        },
      });
      if (count === 1) {
        await tx.ticketHistory.create({
          data: { ticketId, field: 'triage', newValue: `${output.priority} / ${output.category}` },
        });
      }
      return count === 1;
    });

    return saved ? 'suggested' : 'skipped';
  }

  /** Chamado pelo worker quando o job esgota as tentativas (ou o erro não é recuperável). */
  async markFailed(ticketId: string, error: string, attempts: number): Promise<void> {
    await this.prisma.triageSuggestion.updateMany({
      where: { ticketId, status: 'PENDING' },
      data: { status: 'FAILED', error: error.slice(0, 500), attempts },
    });
    this.logger.warn({ ticketId, attempts }, 'Triagem falhou definitivamente');
  }

  /** Sugestões presas em PENDING (ex.: Redis estava fora na hora de publicar). */
  async findStalePending(olderThan: Date): Promise<string[]> {
    const rows = await this.prisma.triageSuggestion.findMany({
      where: { status: 'PENDING', createdAt: { lt: olderThan } },
      select: { ticketId: true },
      take: 100,
    });
    return rows.map((r) => r.ticketId);
  }
}
