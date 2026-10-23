import { query } from '../db/index.js';
import { WebhookPayload } from '../schemas/webhook.schema.js';

export interface ProcessWebhookResult {
  isNew: boolean;
  eventId: string;
  id?: string;
}

export class WebhookService {
  async processEvent(payload: WebhookPayload, rawPayload: any): Promise<ProcessWebhookResult> {
    const normalizedEventType = payload.event_type.replace('sale.', '');

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
