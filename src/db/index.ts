import pg from 'pg';
import { env } from '../config/env.js';

const { Pool } = pg;

const usar_banco_memoria =
  process.env.NODE_ENV === 'test' || process.env.USE_MEMORY_DB === 'true';

export function isMemoryDb(): boolean {
  return usar_banco_memoria;
}

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (erro) => {
  if (!usar_banco_memoria) {
    console.error('[ERRO] Falha inesperada no pool do PostgreSQL:', erro);
  }
});

export async function query<T extends pg.QueryResultRow = any>(
  sql_texto: string,
  parametros?: any[]
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(sql_texto, parametros);
}

export async function checkConnection(): Promise<boolean> {
  if (usar_banco_memoria) {
    return true;
  }
  try {
    const resposta = await pool.query('SELECT 1 as healthy');
    return resposta.rows[0]?.healthy === 1;
  } catch (erro) {
    return false;
  }
}
