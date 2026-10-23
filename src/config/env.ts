import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url().default('postgresql://postgres:postgres@localhost:5432/twr_postbacks'),
  WEBHOOK_SECRET: z.string().min(8).default('twr_webhook_secret_key_2026'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Erro na configuração de variáveis de ambiente:', parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;
