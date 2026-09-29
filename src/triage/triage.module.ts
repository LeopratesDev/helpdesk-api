import { Module } from '@nestjs/common';
import { TicketsModule } from '../tickets/tickets.module';
import { TriageDecisionService } from './triage-decision.service';
import { TriageController } from './triage.controller';

/** Parte da triagem que roda na API (consulta e decisão). O processamento fica no worker. */
@Module({
  imports: [TicketsModule],
  controllers: [TriageController],
  providers: [TriageDecisionService],
})
export class TriageModule {}
