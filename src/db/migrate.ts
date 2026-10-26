import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations() {
  const cliente_banco = await pool.connect();
  try {
    console.log('[MIGRACAO] Executando migracoes do banco de dados...');
    
    // Tabela para controlar migracoes ja executadas
    await cliente_banco.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const diretorio_migracoes = path.join(__dirname, 'migrations');
    const arquivos = await fs.readdir(diretorio_migracoes);
    const arquivos_sql = arquivos.filter((arquivo) => arquivo.endsWith('.sql')).sort();

    for (const arquivo of arquivos_sql) {
      const ja_executado = await cliente_banco.query(
        'SELECT 1 FROM _migrations WHERE name = $1',
        [arquivo]
      );

      if (ja_executado.rowCount === 0) {
        console.log(`[MIGRACAO] Aplicando migracao: ${arquivo}`);
        const conteudo_sql = await fs.readFile(path.join(diretorio_migracoes, arquivo), 'utf-8');
        
        await cliente_banco.query('BEGIN');
        try {
          await cliente_banco.query(conteudo_sql);
          await cliente_banco.query('INSERT INTO _migrations (name) VALUES ($1)', [arquivo]);
          await cliente_banco.query('COMMIT');
          console.log(`[MIGRACAO] Migracao ${arquivo} concluida com sucesso.`);
        } catch (erro) {
          await cliente_banco.query('ROLLBACK');
          console.error(`[ERRO] Falha na migracao ${arquivo}:`, erro);
          throw erro;
        }
      }
    }

    console.log('[MIGRACAO] Todas as migracoes estao atualizadas.');
  } finally {
    cliente_banco.release();
  }
}

export const executar_migracoes = runMigrations;

// Se executado diretamente pelo terminal (npm run db:migrate)
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
