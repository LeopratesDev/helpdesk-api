import { InvalidLlmOutputError, parseTriageOutput } from './triage.schema';

const categories = ['Financeiro', 'Acesso e login'];
const valid = {
  category: 'Financeiro',
  priority: 'ALTA',
  summary: 'Cliente cobrado em duplicidade',
  confidence: 0.9,
};

describe('parseTriageOutput (validação da saída do LLM)', () => {
  it('aceita uma resposta válida', () => {
    expect(parseTriageOutput(valid, categories)).toEqual(valid);
  });

  it('normaliza a categoria para o nome cadastrado (caixa e espaços)', () => {
    expect(parseTriageOutput({ ...valid, category: ' financeiro ' }, categories).category).toBe(
      'Financeiro',
    );
  });

  it.each([
    ['prioridade fora do enum', { ...valid, priority: 'URGENTISSIMA' }, 'priority'],
    ['confiança acima de 1', { ...valid, confidence: 1.5 }, 'confidence'],
    ['confiança negativa', { ...valid, confidence: -0.1 }, 'confidence'],
    ['resumo vazio', { ...valid, summary: '' }, 'summary'],
    ['resumo longo demais', { ...valid, summary: 'x'.repeat(141) }, 'summary'],
    ['campo faltando', { category: 'Financeiro', priority: 'ALTA' }, 'summary'],
    ['categoria que não existe', { ...valid, category: 'Jurídico' }, 'category'],
  ])('rejeita %s', (_, raw, field) => {
    expect(() => parseTriageOutput(raw, categories)).toThrow(InvalidLlmOutputError);
    expect(() => parseTriageOutput(raw, categories)).toThrow(field);
  });

  it.each([
    ['texto que não é JSON', 'Claro! A categoria é Financeiro.'],
    ['null', null],
    ['array', [valid]],
  ])('rejeita %s', (_, raw) => {
    expect(() => parseTriageOutput(raw, categories)).toThrow(InvalidLlmOutputError);
  });
});
