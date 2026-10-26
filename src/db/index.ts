import pg from 'pg';
import { env } from '../config/env.js';

const { Pool } = pg;

let useMemory =
  process.env.NODE_ENV === 'test' || process.env.USE_MEMORY_DB === 'true';

export function isMemoryDb(): boolean {
  return useMemory;
}

export function setMemoryDb(enabled: boolean) {
  useMemory = enabled;
}

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  if (!useMemory) {
    console.error('Erro inesperado no pool do PostgreSQL:', err);
  }
});

export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params);
}

export async function checkConnection(): Promise<boolean> {
  if (useMemory) {
    return true;
  }
  try {
    const res = await pool.query('SELECT 1 as healthy');
    return res.rows[0]?.healthy === 1;
  } catch (err) {
    return false;
  }
}
