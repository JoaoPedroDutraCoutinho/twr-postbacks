import { isMemoryDb, query } from '../db/index.js';
import { memoryDb } from '../db/memory.js';
import { WebhookPayload } from '../schemas/webhook.schema.js';

export interface ProcessWebhookResult {
  isNew: boolean;
  eventId: string;
  id?: string;
}

export class WebhookService {
  async processEvent(payload: WebhookPayload, rawPayload: any): Promise<ProcessWebhookResult> {
    const normalizedEventType = payload.event_type.replace('sale.', '');

    // Se estiver em modo de teste ou banco em memória
    if (isMemoryDb()) {
      const memResult = memoryDb.insertEvent({
        platform: payload.platform,
        event_id: payload.event_id,
        event_type: normalizedEventType,
        order_id: payload.order_id,
        product_id: payload.product.id,
        product_name: payload.product.name,
        currency: payload.currency,
        amount_cents: payload.amount_cents,
        customer_email: payload.customer.email,
        customer_name: payload.customer.name,
        payload: rawPayload,
        event_created_at: new Date(payload.event_created_at),
      });

      return {
        isNew: memResult.rowCount > 0,
        eventId: payload.event_id,
        id: memResult.rows[0]?.id,
      };
    }

    const insertSql = `
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

    const values = [
      payload.platform,
      payload.event_id,
      normalizedEventType,
      payload.order_id,
      payload.product.id,
      payload.product.name,
      payload.currency,
      payload.amount_cents,
      payload.customer.email,
      payload.customer.name || null,
      JSON.stringify(rawPayload),
      payload.event_created_at,
    ];

    const result = await query(insertSql, values);

    // Se rowCount for 0, o registro já existia (idempotência disparada pelo ON CONFLICT)
    if (result.rowCount === 0) {
      return {
        isNew: false,
        eventId: payload.event_id,
      };
    }

    return {
      isNew: true,
      eventId: payload.event_id,
      id: result.rows[0].id,
    };
  }
}
