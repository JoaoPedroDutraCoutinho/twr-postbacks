import { runMigrations } from './migrate.js';
import { pool } from './index.js';

try {
  await runMigrations();
  console.log('[MIGRACAO] OK');
  await pool.end();
  process.exit(0);
} catch (erro) {
  console.error('[ERRO] Migracao falhou:', erro);
  process.exit(1);
}