import { z } from 'zod';

export const webhookPayloadSchema = z.object({
  platform: z.string().min(1, 'platform é obrigatório'),
  event_id: z.string().min(1, 'event_id é obrigatório'),
  event_type: z.enum([
    'approved',
    'refunded',
    'canceled',
    'pending',
    'sale.approved',
    'sale.refunded',
    'sale.canceled',
    'sale.pending',
  ]),
  order_id: z.string().min(1, 'order_id é obrigatório'),
  product: z.object({
    id: z.string().min(1, 'product.id é obrigatório'),
    name: z.string().min(1).default('Produto'),
  }),
  currency: z
    .string()
    .length(3, 'currency deve ser um código de 3 letras (ex: BRL, USD)')
    .toUpperCase(),
  amount_cents: z
    .number()
    .int('amount_cents deve ser um número inteiro')
    .nonnegative('amount_cents não pode ser negativo'),
  customer: z.object({
    email: z.string().email('customer.email inválido'),
    name: z.string().optional(),
  }),
  event_created_at: z
    .string()
    .datetime({ offset: true })
    .or(z.string().datetime())
    .optional()
    .default(() => new Date().toISOString()),
});

export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;
