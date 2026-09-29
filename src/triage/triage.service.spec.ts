import { LlmTimeoutError, withTimeout } from './triage.service';

describe('withTimeout', () => {
  it('devolve o resultado quando a promessa termina a tempo', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 100)).resolves.toBe('ok');
  });

  it('rejeita com LlmTimeoutError quando o LLM não responde', async () => {
    const never = new Promise<never>(() => undefined);
    await expect(withTimeout(never, 50)).rejects.toBeInstanceOf(LlmTimeoutError);
  });

  it('propaga o erro original se ele vier antes do timeout', async () => {
    const boom = new Error('rede caiu');
    await expect(withTimeout(Promise.reject(boom), 100)).rejects.toBe(boom);
  });
});
