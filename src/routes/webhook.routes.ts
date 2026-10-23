import { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';
import { webhookPayloadSchema } from '../schemas/webhook.schema.js';
import { WebhookService } from '../services/webhook.service.js';
import { verifyHmacSignature } from '../utils/hmac.js';

export async function webhookRoutes(app: FastifyInstance) {
  const webhookService = new WebhookService();

  app.post('/webhooks/sales', async (request, reply) => {
    const signature = request.headers['x-signature'] as string | undefined;

    // 1. Validação de assinatura criptográfica HMAC-SHA256 sobre o corpo bruto (raw body)
    const isValidSignature = verifyHmacSignature(
      request.rawBody,
      signature,
      env.WEBHOOK_SECRET
    );

    if (!isValidSignature) {
      return reply.status(401).send({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Assinatura HMAC ausente ou inválida no header X-Signature',
      });
    }

    // 2. Validação do schema do payload com Zod
    const parseResult = webhookPayloadSchema.safeParse(request.body);

    if (!parseResult.success) {
      return reply.status(422).send({
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: 'Payload do webhook inválido ou incompleto',
        issues: parseResult.error.format(),
      });
    }

    // 3. Processamento com garantia de idempotência no PostgreSQL
    const result = await webhookService.processEvent(parseResult.data, request.body);

    if (result.isNew) {
      return reply.status(201).send({
        statusCode: 201,
        status: 'created',
        message: 'Evento processado e registrado com sucesso',
        eventId: result.eventId,
        id: result.id,
      });
    }

    // Retorna 200 OK para sinalizar à plataforma que o evento já foi acolhido
    return reply.status(200).send({
      statusCode: 200,
      status: 'duplicate',
      message: 'Evento duplicado detectado. Nenhuma ação duplicada realizada.',
      eventId: result.eventId,
    });
  });
}
