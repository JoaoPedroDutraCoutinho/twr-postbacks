import { buildApp } from './app.js';
import { env } from './config/env.js';

const app = buildApp();

const start = async () => {
  try {
    const address = await app.listen({ port: env.PORT, host: '0.0.0.0' });
    app.log.info(`🚀 Servidor rodando em ${address}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
