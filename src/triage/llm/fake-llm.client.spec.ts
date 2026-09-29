import { parseTriageOutput } from '../triage.schema';
import { FakeLlmClient } from './fake-llm.client';

const categories = ['Acesso e login', 'Bug no sistema', 'Dúvida de uso', 'Financeiro'];
const fake = new FakeLlmClient();

describe('FakeLlmClient (modo sem chave)', () => {
  it('classifica por palavra-chave e produz saída que passa na validação', async () => {
    const { raw, model } = await fake.triage({
      title: 'Cobrança duplicada no cartão',
      description: 'Fui cobrado duas vezes este mês.',
      categories,
    });
    expect(model).toBe('fake');
    expect(parseTriageOutput(raw, categories)).toMatchObject({
      category: 'Financeiro',
      priority: 'ALTA',
    });
  });

  it('marca como crítico quando o sistema está parado', async () => {
    const { raw } = await fake.triage({
      title: 'Sistema fora do ar',
      description: 'Todos os usuários sem acesso, urgente',
      categories,
    });
    expect(raw).toMatchObject({ priority: 'CRITICA' });
  });

  it('é determinístico', async () => {
    const input = { title: 'Como exportar relatório?', description: 'Dúvida', categories };
    expect(await fake.triage(input)).toEqual(await fake.triage(input));
  });

  it('usa a primeira categoria e confiança baixa quando nada casa', async () => {
    const { raw } = await fake.triage({ title: 'Olá', description: 'Texto genérico', categories });
    expect(raw).toMatchObject({ category: 'Acesso e login', priority: 'MEDIA', confidence: 0.4 });
  });
});
