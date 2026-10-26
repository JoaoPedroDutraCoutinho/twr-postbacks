import { buildApp } from './app.js';
import { env } from './config/env.js';
import { runMigrations } from './db/migrate.js';

const aplicacao = buildApp();

const iniciar_servidor = async () => {
  try {
    if (process.env.NODE_ENV !== 'test') {
      try {
        await runMigrations();
      } catch (erro_migracao) {
        aplicacao.log.warn(
          { err: erro_migracao },
          '[AVISO] Nao foi possivel rodar as migracoes na inicializacao:'
        );
      }
    }

    const endereco = await aplicacao.listen({ port: env.PORT, host: '0.0.0.0' });
    aplicacao.log.info(`[INFO] Servidor rodando em ${endereco}`);
  } catch (erro) {
    aplicacao.log.error(erro);
    process.exit(1);
  }
};

iniciar_servidor();
