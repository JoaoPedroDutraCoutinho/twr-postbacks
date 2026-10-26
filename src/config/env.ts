import 'dotenv/config';
import { z } from 'zod';

const schema_ambiente = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url().default('postgresql://postgres:postgres@localhost:5432/twr_postbacks'),
  WEBHOOK_SECRET: z.string().min(8).default('twr_webhook_secret_key_2026'),
});

const resultado_validacao = schema_ambiente.safeParse(process.env);

if (!resultado_validacao.success) {
  console.error('[ERRO] Falha na configuracao de variaveis de ambiente:', resultado_validacao.error.format());
  process.exit(1);
}

export const config_ambiente = resultado_validacao.data;
export const env = config_ambiente;
