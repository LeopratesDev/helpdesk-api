import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { ENV } from '../config/config.module';
import { Env } from '../config/env.schema';
import { redisConnection } from '../queue/redis-connection';
import { SlaService } from './sla.service';

export const SLA_QUEUE = 'sla';
const SCHEDULER_ID = 'sla-check';

/**
 * Job agendado de SLA (roda só no processo worker).
 * upsertJobScheduler é idempotente: reiniciar o worker, ou subir vários,
 * não cria agendamentos duplicados — existe um único "sla-check" no Redis.
 */
@Injectable()
export class SlaWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SlaWorker.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly sla: SlaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async onModuleInit(): Promise<void> {
    const connection = redisConnection(this.env.REDIS_URL);
    this.queue = new Queue(SLA_QUEUE, { connection });
    await this.queue.upsertJobScheduler(
      SCHEDULER_ID,
      { every: this.env.SLA_CHECK_INTERVAL_MS },
      { name: 'check-overdue', opts: { removeOnComplete: 100, removeOnFail: 500 } },
    );

    this.worker = new Worker(
      SLA_QUEUE,
      async () => {
        const ids = await this.sla.markOverdue(new Date());
        if (ids.length) this.logger.log({ breached: ids.length }, 'Chamados com SLA estourado');
        return { breached: ids.length };
      },
      { connection },
    );
    this.worker.on('failed', (job, err) =>
      this.logger.error({ jobId: job?.id, err: err.message }, 'Falha no job de SLA'),
    );
    this.logger.log(`Job de SLA agendado a cada ${this.env.SLA_CHECK_INTERVAL_MS} ms`);
  }

  async onModuleDestroy(): Promise<void> {
    // Espera o job em andamento terminar antes de fechar (graceful shutdown)
    await this.worker?.close();
    await this.queue?.close();
  }
}
