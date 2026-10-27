import { FastifyInstance } from 'fastify';

export async function metricsRoutes(app: FastifyInstance) {
  app.get('/metrics', async (request, reply) => {
    reply.header('Content-Type', app.metricas.registro.contentType);
    return app.metricas.registro.metrics();
  });
}
