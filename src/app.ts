import Fastify, { FastifyError, FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { trace } from '@opentelemetry/api';
import crypto from 'node:crypto';
import { criar_metricas, Metricas } from './observability/metrics.js';
import { healthRoutes } from './routes/health.routes.js';
import { metricsRoutes } from './routes/metrics.routes.js';
import { reportRoutes } from './routes/report.routes.js';
import { webhookRoutes } from './routes/webhook.routes.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: Buffer;
    invalidJson?: boolean;
  }
  interface FastifyInstance {
    metricas: Metricas;
  }
}

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
    },
    // Render (e outros PaaS) ficam atras de proxy: usa o IP real do cliente (X-Forwarded-For) no rate limit
    trustProxy: true,
    // Observabilidade: Correlation ID / Request ID unico por requisicao
    requestIdHeader: 'x-request-id',
    genReqId: (req) =>
      (req.headers['x-request-id'] as string) ||
      `req_${crypto.randomBytes(6).toString('hex')}`,
  });

  const metricas = criar_metricas();
  app.decorate('metricas', metricas);

  // Com o tracing ligado, o span HTTP passa a ter o nome da rota (ex: "POST /webhooks/sales")
  app.addHook('onRequest', async (request) => {
    const span_ativo = trace.getActiveSpan();
    const rota = request.routeOptions.url;
    if (span_ativo && rota) {
      span_ativo.updateName(`${request.method} ${rota}`);
      span_ativo.setAttribute('http.route', rota);
    }
  });

  // Retorna o x-request-id (e o x-trace-id, se o tracing estiver ligado) para rastreamento
  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
    const span_ativo = trace.getActiveSpan();
    if (span_ativo) {
      reply.header('x-trace-id', span_ativo.spanContext().traceId);
    }
  });

  app.addHook('onResponse', async (request, reply) => {
    metricas.observar_resposta(request.method, request.routeOptions.url, reply.statusCode, reply.elapsedTime);
  });
  if (process.env.NODE_ENV !== 'test') {
    app.register(rateLimit, {
      global: false,
    });
  }

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
      } catch {
        // JSON quebrado so e rejeitado na rota, DEPOIS da verificacao da assinatura:
        // sem assinatura valida a resposta e sempre 401, sem revelar detalhes do parser
        req.invalidJson = true;
        done(null, undefined);
      }
    }
  );

  app.register(healthRoutes);
  app.register(metricsRoutes);
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
