// Validado uma vez, no import. Se faltar ou vier errado, o processo nem
// chega a abrir a porta — falha no boot, não numa request no meio do dia.

import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'obrigatória'),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CORS_ORIGIN: z.string().min(1, 'obrigatória'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`Configuração de ambiente inválida:\n${issues}`);
}

export const env = parsed.data;
