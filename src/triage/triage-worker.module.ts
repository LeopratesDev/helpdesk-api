import { Logger, Module } from '@nestjs/common';
import { ENV } from '../config/config.module';
import { Env } from '../config/env.schema';
import { AnthropicLlmClient } from './llm/anthropic-llm.client';
import { FakeLlmClient } from './llm/fake-llm.client';
import { LLM_CLIENT, LlmClient } from './llm/llm-client';
import { TriageService } from './triage.service';
import { TriageWorker } from './triage.worker';

/**
 * Provider factory: escolhe a implementação do LLM na inicialização.
 * Sem ANTHROPIC_API_KEY → modo fake (ninguém paga nada para rodar o projeto).
 */
const llmClientProvider = {
  provide: LLM_CLIENT,
  inject: [ENV],
  useFactory: (env: Env): LlmClient => {
    const logger = new Logger('LlmClient');
    if (!env.ANTHROPIC_API_KEY) {
      logger.warn('ANTHROPIC_API_KEY ausente: triagem em MODO FAKE (regras locais)');
      return new FakeLlmClient();
    }
    logger.log(`Triagem com ${env.LLM_MODEL}`);
    return AnthropicLlmClient.create(env.ANTHROPIC_API_KEY, env.LLM_MODEL, env.LLM_TIMEOUT_MS);
  },
};

/** Importado só pelo WorkerModule. */
@Module({
  providers: [llmClientProvider, TriageService, TriageWorker],
})
export class TriageWorkerModule {}
