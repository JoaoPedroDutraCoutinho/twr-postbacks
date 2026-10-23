import { z } from 'zod';

export const reportQuerySchema = z.object({
  from: z
    .string()
    .datetime({ offset: true })
    .or(z.string().datetime())
    .optional(),
  to: z
    .string()
    .datetime({ offset: true })
    .or(z.string().datetime())
    .optional(),
  group_by: z.enum(['day', 'product', 'platform']).optional(),
});

export type ReportQueryParams = z.infer<typeof reportQuerySchema>;

export interface CurrencySummary {
  currency: string;
  gross_cents: number;
  refunded_cents: number;
  net_cents: number;
  sales_count: number;
  refunds_count: number;
}

export interface GroupedSummary extends CurrencySummary {
  group_key: string;
  group_name?: string;
}

export interface SalesReportResponse {
  period: {
    from: string;
    to: string;
    timezone: string;
  };
  group_by?: 'day' | 'product' | 'platform';
  currencies: CurrencySummary[];
  groups?: GroupedSummary[];
}
