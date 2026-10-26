import { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';
import { webhookPayloadSchema } from '../schemas/webhook.schema.js';
import { WebhookService } from '../services/webhook.service.js';
import { verifyHmacSignature } from '../utils/hmac.js';

export async function webhookRoutes(app: FastifyInstance) {
  const servico_webhook = new WebhookService();

  app.post('/webhooks/sales', async (request, reply) => {
    const assinatura = request.headers['x-signature'] as string | undefined;

    // 1. Validacao de assinatura criptografica HMAC-SHA256 sobre o corpo bruto (raw body)
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

    // 2. Validacao do schema do payload com Zod
    const resultado_validacao = webhookPayloadSchema.safeParse(request.body);

    if (!resultado_validacao.success) {
      return reply.status(422).send({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: 'Payload do webhook invalido ou incompleto',
        issues: resultado_validacao.error.format(),
      });
    }

    // 3. Processamento e registro da venda com garantia de idempotencia
    const resultado_criacao = await servico_webhook.criar_vendas(
      resultado_validacao.data,
      request.body
    );

    if (resultado_criacao.isNew) {
      return reply.status(201).send({
        statusCode: 201,
        status: 'created',
        message: 'Evento processado e registrado com sucesso',
        eventId: resultado_criacao.eventId,
        id: resultado_criacao.id,
      });
    }

    // Retorna 200 OK para sinalizar a plataforma que o evento ja foi acolhido
    return reply.status(200).send({
      statusCode: 200,
      status: 'duplicate',
      message: 'Evento duplicado detectado. Nenhuma acao duplicada realizada.',
      eventId: resultado_criacao.eventId,
    });
  });
}
