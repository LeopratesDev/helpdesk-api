import { Global, Module } from '@nestjs/common';
import { TriageProducer } from './triage.producer';

/** Fila disponível para toda a API (TicketsService publica, Health e Admin leem). */
@Global()
@Module({
  providers: [TriageProducer],
  exports: [TriageProducer],
})
export class QueueModule {}
