import { z } from 'zod';

/**
 * Variáveis de ambiente validadas na inicialização.
 * Se alguma obrigatória faltar ou for inválida, a aplicação não sobe.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  SLA_CHECK_INTERVAL_MS: z.coerce.number().int().min(1000).default(60_000),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET precisa de pelo menos 32 caracteres'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  LOGIN_RATE_LIMIT: z.coerce.number().int().positive().default(5),
  // Opcional: vazio ou ausente → triagem em modo fake (sem custo)
  ANTHROPIC_API_KEY: z
    .string()
    .optional()
    .transform((v) => (v?.trim() ? v.trim() : undefined)),
  LLM_MODEL: z.string().default('claude-haiku-4-5'),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(100).default(15_000),
  TRIAGE_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(4),
  TRIAGE_BACKOFF_MS: z.coerce.number().int().min(10).default(2_000),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Configuração inválida:\n${issues}`);
  }
  return result.data;
}
