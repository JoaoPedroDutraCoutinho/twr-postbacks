import { FastifyInstance } from 'fastify';
import { checkConnection } from '../db/index.js';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/', async () => ({
    service: 'twr-postbacks',
    status: 'online',
    endpoints: {
      health: 'GET /health',
      webhook: 'POST /webhooks/sales',
      report: 'GET /reports/sales',
    },
  }));

  app.get('/health', async (request, reply) => {
    const isDbConnected = await checkConnection();

    if (!isDbConnected) {
      return reply.status(503).send({
        status: 'error',
        uptime: process.uptime(),
        database: 'disconnected',
        timestamp: new Date().toISOString(),
      });
    }

    return reply.status(200).send({
      status: 'ok',
      uptime: process.uptime(),
      database: 'connected',
      timestamp: new Date().toISOString(),
    });
  });
}
