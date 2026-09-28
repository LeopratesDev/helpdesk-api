import { validateEnv } from './env.schema';

describe('validateEnv', () => {
  it('aplica valores padrão quando variáveis opcionais faltam', () => {
    const env = validateEnv({});
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
  });

  it('converte PORT de string para número', () => {
    expect(validateEnv({ PORT: '8080' }).PORT).toBe(8080);
  });

  it('lança erro descritivo com valor inválido', () => {
    expect(() => validateEnv({ PORT: 'abc' })).toThrow(/Configuração inválida[\s\S]*PORT/);
  });
});
