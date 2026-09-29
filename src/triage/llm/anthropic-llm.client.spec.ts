import Anthropic from '@anthropic-ai/sdk';
import { AnthropicLlmClient } from './anthropic-llm.client';
import { NonRetryableLlmError } from './llm-client';

/**
 * O SDK é substituído por um objeto falso: testamos NOSSA lógica em volta da
 * chamada (prompt, parse, classificação de erros) sem rede e sem custo.
 */
function clientReturning(impl: () => Promise<unknown>) {
  const create = jest.fn(impl);
  const sdk = { messages: { create } } as unknown as Anthropic;
  return { client: new AnthropicLlmClient(sdk, 'claude-haiku-4-5'), create };
}

const message = (text: string, stop_reason = 'end_turn') => ({
  model: 'claude-haiku-4-5',
  stop_reason,
  content: [{ type: 'text', text }],
});

const input = {
  title: 'Boleto errado',
  description: 'Valor veio dobrado',
  categories: ['Financeiro'],
};

describe('AnthropicLlmClient', () => {
  it('envia modelo, categorias e formato estruturado; devolve o JSON cru', async () => {
    const json = { category: 'Financeiro', priority: 'ALTA', summary: 'Boleto', confidence: 0.8 };
    const { client, create } = clientReturning(() =>
      Promise.resolve(message(JSON.stringify(json))),
    );

    const result = await client.triage(input);

    expect(result).toEqual({ raw: json, model: 'claude-haiku-4-5' });
    const params = (create.mock.calls[0] as unknown[])[0] as Anthropic.MessageCreateParams;
    expect(params.model).toBe('claude-haiku-4-5');
    expect(params.output_config?.format?.type).toBe('json_schema');
    expect(JSON.stringify(params.messages)).toContain('Categorias disponíveis: Financeiro');
    expect(JSON.stringify(params.messages)).toContain('<chamado>');
  });

  it('JSON quebrado volta como texto cru (a validação Zod decide)', async () => {
    const { client } = clientReturning(() => Promise.resolve(message('{"category": ')));
    expect((await client.triage(input)).raw).toBe('{"category": ');
  });

  it('recusa do modelo não é repetida', async () => {
    const { client } = clientReturning(() => Promise.resolve(message('', 'refusal')));
    await expect(client.triage(input)).rejects.toBeInstanceOf(NonRetryableLlmError);
  });

  it('resposta cortada por max_tokens é erro recuperável', async () => {
    const { client } = clientReturning(() => Promise.resolve(message('{', 'max_tokens')));
    const error = await client.triage(input).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(NonRetryableLlmError);
  });

  it.each([400, 401, 403, 404])(
    'HTTP %i não é repetido (chave/requisição inválida)',
    async (status) => {
      const err = Anthropic.APIError.generate(
        status,
        { error: { message: 'x' } },
        'x',
        new Headers(),
      );
      const { client } = clientReturning(() => Promise.reject(err));
      await expect(client.triage(input)).rejects.toBeInstanceOf(NonRetryableLlmError);
    },
  );

  it.each([429, 500, 529])('HTTP %i é repassado para o retry do BullMQ', async (status) => {
    const err = Anthropic.APIError.generate(
      status,
      { error: { message: 'x' } },
      'x',
      new Headers(),
    );
    const { client } = clientReturning(() => Promise.reject(err));
    const error = await client.triage(input).catch((e: unknown) => e);
    expect(error).toBe(err);
  });
});
