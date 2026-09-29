import { Env } from '../config/env.schema';
import { TriageProducer } from './triage.producer';

describe('TriageProducer com Redis fora do ar', () => {
  // Porta onde nada escuta: simula o Redis indisponível
  const env = {
    REDIS_URL: 'redis://127.0.0.1:1',
    TRIAGE_MAX_ATTEMPTS: 3,
    TRIAGE_BACKOFF_MS: 50,
  } as Env;
  let producer: TriageProducer;

  beforeAll(() => {
    producer = new TriageProducer(env);
    producer.queue.on('error', () => undefined); // evita log de erro de conexão no teste
  });

  afterAll(async () => {
    // close() espera a conexão que nunca vai subir; limitamos o tempo da limpeza
    await Promise.race([
      producer.queue.close().catch(() => undefined),
      new Promise((r) => setTimeout(r, 1_000).unref()),
    ]);
  });

  it('não lança erro e responde em poucos segundos (a requisição HTTP não trava)', async () => {
    const started = Date.now();
    await expect(producer.enqueue('ticket-1')).resolves.toBe(false);
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});
