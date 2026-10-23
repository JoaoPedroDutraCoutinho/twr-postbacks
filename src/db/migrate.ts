import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations() {
  const client = await pool.connect();
  try {
    console.log('🔄 Executando migrações do banco de dados...');
    
    // Tabela para controlar migrações já executadas
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const migrationsDir = path.join(__dirname, 'migrations');
    const files = await fs.readdir(migrationsDir);
    const sqlFiles = files.filter((f) => f.endsWith('.sql')).sort();

    for (const file of sqlFiles) {
      const alreadyExecuted = await client.query(
        'SELECT 1 FROM _migrations WHERE name = $1',
        [file]
      );

      if (alreadyExecuted.rowCount === 0) {
        console.log(`⏳ Aplicando migração: ${file}`);
        const sql = await fs.readFile(path.join(migrationsDir, file), 'utf-8');
        
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
          await client.query('COMMIT');
          console.log(`✅ Migração ${file} concluída.`);
        } catch (err) {
          await client.query('ROLLBACK');
          console.error(`❌ Falha na migração ${file}:`, err);
          throw err;
        }
      }
    }

    console.log('🎉 Todas as migrações estão atualizadas.');
  } finally {
    client.release();
  }
}

// Se executado diretamente pelo terminal (npm run db:migrate)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
