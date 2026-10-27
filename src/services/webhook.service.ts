import { isMemoryDb, query } from '../db/index.js';
import { memoryDb } from '../db/memory.js';
import { WebhookPayload } from '../schemas/webhook.schema.js';

export interface ResultadoProcessamentoWebhook {
  isNew: boolean;
  eventId: string;
  id?: string;
}

export class WebhookService {
  async registrar_evento(dados_payload: WebhookPayload, payload_bruto: any): Promise<ResultadoProcessamentoWebhook> {
    const tipo_evento_normalizado = dados_payload.event_type.replace('sale.', '');

    // Se estiver em modo de teste ou banco em memoria
    if (isMemoryDb()) {
      const resultado_memoria = memoryDb.inserir_evento({
        platform: dados_payload.platform,
        event_id: dados_payload.event_id,
        event_type: tipo_evento_normalizado,
        order_id: dados_payload.order_id,
        product_id: dados_payload.product.id,
        product_name: dados_payload.product.name,
        currency: dados_payload.currency,
        amount_cents: dados_payload.amount_cents,
        customer_email: dados_payload.customer.email,
        customer_name: dados_payload.customer.name,
        payload: payload_bruto,
        event_created_at: new Date(dados_payload.event_created_at),
      });

      return {
        isNew: resultado_memoria.rowCount > 0,
        eventId: dados_payload.event_id,
        id: resultado_memoria.rows[0]?.id,
      };
    }

    const sql_insercao = `
      INSERT INTO sale_events (
        platform,
        event_id,
        event_type,
        order_id,
        product_id,
        product_name,
        currency,
        amount_cents,
        customer_email,
        customer_name,
        payload,
        event_created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
      )
      ON CONFLICT (platform, event_id) DO NOTHING
      RETURNING id;
    `;

    const valores = [
      dados_payload.platform,
      dados_payload.event_id,
      tipo_evento_normalizado,
      dados_payload.order_id,
      dados_payload.product.id,
      dados_payload.product.name,
      dados_payload.currency,
      dados_payload.amount_cents,
      dados_payload.customer.email,
      dados_payload.customer.name || null,
      JSON.stringify(payload_bruto),
      dados_payload.event_created_at,
    ];

    const resultado = await query(sql_insercao, valores);

    if (resultado.rowCount === 0) {
      return {
        isNew: false,
        eventId: dados_payload.event_id,
      };
    }

    return {
      isNew: true,
      eventId: dados_payload.event_id,
      id: resultado.rows[0].id,
    };
  }
}
