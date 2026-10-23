import { buildApp } from './app.js';
import { env } from './config/env.js';
import { runMigrations } from './db/migrate.js';

const app = buildApp();

const start = async () => {
  try {
    // Executa migrações pendentes no banco automaticamente na inicialização
    if (process.env.NODE_ENV !== 'test') {
      try {
        await runMigrations();
      } catch (migrationErr) {
        app.log.warn(
          { err: migrationErr },
          '⚠️ Não foi possível rodar as migrações na inicialização (PostgreSQL pode estar iniciando):'
        );
      }
    }

    const address = await app.listen({ port: env.PORT, host: '0.0.0.0' });
    app.log.info(`🚀 Servidor rodando em ${address}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
