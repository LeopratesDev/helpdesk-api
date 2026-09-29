import { Controller, Get, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Queue } from 'bullmq';
import { Roles } from '../auth/auth.decorators';
import { ENV } from '../config/config.module';
import { Env } from '../config/env.schema';
import { SLA_QUEUE } from './queue.constants';
import { redisConnection } from './redis-connection';
import { TriageProducer } from './triage.producer';

interface FailedJobView {
  queue: string;
  id: string | undefined;
  name: string;
  data: unknown;
  failedReason: string;
  attemptsMade: number;
  failedAt: string | null;
}

/**
 * "Dead letter" visível: jobs que esgotaram as tentativas ficam no conjunto
 * "failed" do BullMQ (removeOnFail: false) e aparecem aqui para o Admin.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/queues')
export class AdminQueuesController implements OnModuleDestroy {
  private readonly slaQueue: Queue;

  constructor(
    private readonly triage: TriageProducer,
    @Inject(ENV) env: Env,
  ) {
    this.slaQueue = new Queue(SLA_QUEUE, {
      connection: { ...redisConnection(env.REDIS_URL), maxRetriesPerRequest: 1 },
    });
  }

  @Get('failed')
  @ApiOkResponse({ description: 'Últimos 50 jobs falhos de cada fila' })
  async failed(): Promise<FailedJobView[]> {
    const queues = [this.triage.queue as Queue, this.slaQueue];
    const lists = await Promise.all(
      queues.map(async (q) =>
        (await q.getFailed(0, 49)).map((job) => ({
          queue: q.name,
          id: job.id,
          name: job.name,
          data: job.data as unknown,
          failedReason: job.failedReason,
          attemptsMade: job.attemptsMade,
          failedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
        })),
      ),
    );
    return lists.flat();
  }

  async onModuleDestroy(): Promise<void> {
    await this.slaQueue.close();
  }
}

@Module({ controllers: [AdminQueuesController] })
export class AdminQueuesModule {}
