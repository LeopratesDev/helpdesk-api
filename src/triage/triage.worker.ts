import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Queue, UnrecoverableError, Worker } from 'bullmq';
import { ENV } from '../config/config.module';
import { Env } from '../config/env.schema';
import { TRIAGE_QUEUE, TriageJobData, triageJobId } from '../queue/queue.constants';
import { redisConnection } from '../queue/redis-connection';
import { NonRetryableLlmError } from './llm/llm-client';
import { InvalidLlmOutputError } from './triage.schema';
import { TriageService } from './triage.service';

const SWEEP_EVERY_MS = 5 * 60_000;
const STALE_AFTER_MS = 2 * 60_000;

/**
 * Consumidor da fila de triagem (processo worker).
 * Retry com backoff exponencial vem das opções do job (attempts/backoff);
 * aqui decidimos o que é recuperável e o que fazer quando as tentativas acabam.
 */
@Injectable()
export class TriageWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TriageWorker.name);
  private worker?: Worker<TriageJobData>;
  private queue?: Queue<TriageJobData>;

  constructor(
    private readonly triage: TriageService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onModuleInit(): Promise<void> {
    const connection = redisConnection(this.env.REDIS_URL);
    this.queue = new Queue<TriageJobData>(TRIAGE_QUEUE, { connection });

    // Varredura: republica sugestões presas em PENDING (jobId fixo evita duplicar)
    await this.queue.upsertJobScheduler(
      'triage-sweep',
      { every: SWEEP_EVERY_MS },
      { name: 'sweep', data: { ticketId: '' }, opts: { removeOnComplete: 10, removeOnFail: 50 } },
    );

    this.worker = new Worker<TriageJobData>(TRIAGE_QUEUE, (job) => this.handle(job), {
      connection,
      concurrency: 5,
    });
    this.worker.on('failed', (job, err) => void this.onFailed(job, err));
    this.logger.log('Worker de triagem iniciado');
  }

  private async handle(job: Job<TriageJobData>): Promise<string> {
    if (job.name === 'sweep') return this.sweep();

    try {
      const outcome = await this.triage.process(job.data.ticketId, job.attemptsMade + 1);
      this.logger.log({ ticketId: job.data.ticketId, outcome, attempt: job.attemptsMade + 1 });
      return outcome;
    } catch (error) {
      if (error instanceof NonRetryableLlmError) {
        // UnrecoverableError: o BullMQ não tenta de novo (vai direto para "failed")
        throw new UnrecoverableError(error.message);
      }
      if (error instanceof InvalidLlmOutputError) {
        this.logger.warn(
          { ticketId: job.data.ticketId, issues: error.issues },
          'Saída do LLM inválida',
        );
      }
      throw error;
    }
  }

  private async sweep(): Promise<string> {
    const stale = await this.triage.findStalePending(new Date(Date.now() - STALE_AFTER_MS));
    for (const ticketId of stale) {
      await this.queue!.add(
        'triage',
        { ticketId },
        {
          jobId: triageJobId(ticketId),
          attempts: this.env.TRIAGE_MAX_ATTEMPTS,
          backoff: { type: 'exponential', delay: this.env.TRIAGE_BACKOFF_MS },
          removeOnFail: false,
        },
      );
    }
    return `republicados: ${stale.length}`;
  }

  private async onFailed(job: Job<TriageJobData> | undefined, err: Error): Promise<void> {
    if (!job || job.name === 'sweep') return;
    const attempts = job.opts.attempts ?? 1;
    const exhausted = job.attemptsMade >= attempts || err instanceof UnrecoverableError;
    this.logger.warn(
      { ticketId: job.data.ticketId, attempt: job.attemptsMade, exhausted, err: err.message },
      'Tentativa de triagem falhou',
    );
    if (exhausted) await this.triage.markFailed(job.data.ticketId, err.message, job.attemptsMade);
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
