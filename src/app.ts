import Fastify, { FastifyError, FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { healthRoutes } from './routes/health.routes.js';
import { reportRoutes } from './routes/report.routes.js';
import { webhookRoutes } from './routes/webhook.routes.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
  }
}

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
    },
    // Observabilidade: Correlation ID / Request ID único por requisição
    requestIdHeader: 'x-request-id',
    genReqId: (req) =>
      (req.headers['x-request-id'] as string) ||
      `req_${crypto.randomBytes(6).toString('hex')}`,
  });

  // Retorna o x-request-id no cabeçalho de resposta para rastreamento distribuído
  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  // Captura o corpo bruto (Buffer) para validação de assinatura HMAC
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req, body, done) => {
      try {
        const rawBuffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
        req.rawBody = rawBuffer;

        if (!rawBuffer || rawBuffer.length === 0) {
          return done(null, {});
        }
        const parsed = JSON.parse(rawBuffer.toString('utf-8'));
        done(null, parsed);
      } catch (err: any) {
        // Payload JSON malformado deve retornar 422 conforme a spec
        err.statusCode = 422;
        done(err, undefined);
      }
    }
  );

  // Registro de rotas
  app.register(healthRoutes);
  app.register(webhookRoutes);
  app.register(reportRoutes);

  // Tratador global de erros
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode = error.statusCode || 500;

    if (statusCode >= 500) {
      request.log.error(error);
    }

    reply.status(statusCode).send({
      statusCode,
      error: error.name || 'InternalServerError',
      message: error.message || 'Erro interno no processamento',
      requestId: request.id,
    });
  });

  return app;
}
