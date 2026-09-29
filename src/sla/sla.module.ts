import { Module } from '@nestjs/common';
import { SlaService } from './sla.service';
import { SlaWorker } from './sla.worker';

/** Importado só pelo WorkerModule: a API não roda jobs. */
@Module({
  providers: [SlaService, SlaWorker],
  exports: [SlaService],
})
export class SlaModule {}
