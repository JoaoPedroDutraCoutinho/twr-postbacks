import { trace } from '@opentelemetry/api';
import { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';
import { webhookPayloadSchema } from '../schemas/webhook.schema.js';
import { WebhookService } from '../services/webhook.service.js';
import { verifyHmacSignature } from '../utils/hmac.js';

export async function webhookRoutes(app: FastifyInstance) {
  const servico_webhook = new WebhookService();

  app.post('/webhooks/sales', {
    config: {
      rateLimit: {
        max: 200,
        timeWindow: '1 minute',
        errorResponseBuilder: (_request, contexto) => ({
          statusCode: 429,
          error: 'Too Many Requests',
          message: `Limite de requisicoes excedido. Tente novamente em ${contexto.after}.`,
        }),
      },
    },
  }, async (request, reply) => {
    const assinatura = request.headers['x-signature'] as string | undefined;

    const assinatura_valida = verifyHmacSignature(
      request.rawBody,
      assinatura,
      env.WEBHOOK_SECRET
    );

    if (!assinatura_valida) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Assinatura HMAC ausente ou invalida no header X-Signature',
      });
    }

    if (request.invalidJson) {
      return reply.status(422).send({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: 'Corpo da requisicao nao e um JSON valido',
      });
    }

    const resultado_validacao = webhookPayloadSchema.safeParse(request.body);

    if (!resultado_validacao.success) {
      return reply.status(422).send({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: 'Payload do webhook invalido ou incompleto',
        issues: resultado_validacao.error.format(),
      });
    }

    const dados_evento = resultado_validacao.data;

    // Permite buscar um evento especifico no Jaeger/Grafana (ex: "esse event_id chegou?")
    const span_ativo = trace.getActiveSpan();
    span_ativo?.setAttributes({
      'webhook.platform': dados_evento.platform,
      'webhook.event_id': dados_evento.event_id,
      'webhook.event_type': dados_evento.event_type,
    });

    const resultado_criacao = await servico_webhook.registrar_evento(dados_evento, request.body);
    span_ativo?.setAttribute('webhook.duplicate', !resultado_criacao.isNew);

    if (resultado_criacao.isNew) {
      return reply.status(201).send({
        statusCode: 201,
        status: 'created',
        message: 'Evento processado e registrado com sucesso',
        eventId: resultado_criacao.eventId,
        id: resultado_criacao.id,
      });
    }

    return reply.status(200).send({
      statusCode: 200,
      status: 'duplicate',
      message: 'Evento duplicado detectado. Nenhuma acao duplicada realizada.',
      eventId: resultado_criacao.eventId,
    });
  });
}
