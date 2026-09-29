import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { ENV } from '../config/config.module';
import { Env } from '../config/env.schema';
import { TRIAGE_QUEUE, TriageJobData, triageJobId } from './queue.constants';
import { redisConnection } from './redis-connection';

const ENQUEUE_TIMEOUT_MS = 2_000;

/** Lado "produtor" da fila de triagem: roda dentro da API. */
@Injectable()
export class TriageProducer implements OnModuleDestroy {
  private readonly logger = new Logger(TriageProducer.name);
  readonly queue: Queue<TriageJobData>;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.queue = new Queue<TriageJobData>(TRIAGE_QUEUE, {
      // Produtor: falha rápido se o Redis cair, em vez de segurar a requisição HTTP
      connection: { ...redisConnection(env.REDIS_URL), maxRetriesPerRequest: 1 },
      defaultJobOptions: {
        attempts: env.TRIAGE_MAX_ATTEMPTS,
        backoff: { type: 'exponential', delay: env.TRIAGE_BACKOFF_MS },
        removeOnComplete: { age: 24 * 3600 },
        removeOnFail: false, // jobs que esgotaram as tentativas ficam visíveis (dead letter)
      },
    });
  }

  /**
   * Publica o job de triagem. Nunca derruba a requisição: se o Redis estiver fora,
   * o chamado já está salvo com a sugestão PENDING e a varredura do worker o
   * republica depois. Retorna se conseguiu publicar agora.
   */
  async enqueue(ticketId: string): Promise<boolean> {
    try {
      await Promise.race([
        this.queue.add('triage', { ticketId }, { jobId: triageJobId(ticketId) }),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('timeout ao publicar na fila')),
            ENQUEUE_TIMEOUT_MS,
          ).unref(),
        ),
      ]);
      return true;
    } catch (error) {
      this.logger.warn({ ticketId, err: (error as Error).message }, 'Falha ao publicar triagem');
      return false;
    }
  }

  /** Faz uma leitura simples no Redis: usado pelo /health. */
  async ping(): Promise<void> {
    await this.queue.getJobCountByTypes('waiting');
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
  }
}
