import { validateEnv } from './env.schema';

const required = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_SECRET: 'x'.repeat(32),
};

describe('validateEnv', () => {
  it('aplica valores padrão quando variáveis opcionais faltam', () => {
    const env = validateEnv(required);
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
  });

  it('converte PORT de string para número', () => {
    expect(validateEnv({ ...required, PORT: '8080' }).PORT).toBe(8080);
  });

  it('lança erro descritivo com valor inválido', () => {
    expect(() => validateEnv({ ...required, PORT: 'abc' })).toThrow(
      /Configuração inválida[\s\S]*PORT/,
    );
  });

  it('lança erro quando DATABASE_URL obrigatória falta', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });
});

describe('validateEnv — JWT', () => {
  it('rejeita JWT_SECRET curto', () => {
    expect(() =>
      validateEnv({ DATABASE_URL: 'postgresql://u:p@localhost:5432/db', JWT_SECRET: 'curto' }),
    ).toThrow(/JWT_SECRET/);
  });
});
