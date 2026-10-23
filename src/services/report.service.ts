import { isMemoryDb, query } from '../db/index.js';
import { memoryDb } from '../db/memory.js';
import {
  CurrencySummary,
  GroupedSummary,
  ReportQueryParams,
  SalesReportResponse,
} from '../schemas/report.schema.js';

export class ReportService {
  async getSalesReport(params: ReportQueryParams): Promise<SalesReportResponse> {
    const toDate = params.to ? new Date(params.to) : new Date();
    const fromDate = params.from
      ? new Date(params.from)
      : new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 dias atrás

    // Se estiver em modo de teste ou banco em memória
    if (isMemoryDb()) {
      const currencies = memoryDb.getTotals(fromDate, toDate);
      const groups = params.group_by
        ? memoryDb.getGrouped(fromDate, toDate, params.group_by)
        : undefined;

      return {
        period: {
          from: fromDate.toISOString(),
          to: toDate.toISOString(),
          timezone: 'UTC',
        },
        group_by: params.group_by,
        currencies,
        groups,
      };
    }

    // 1. Totais consolidados por moeda
    const totalsSql = `
      SELECT
        currency,
        COALESCE(SUM(CASE WHEN event_type = 'approved' THEN amount_cents ELSE 0 END), 0)::BIGINT AS gross_cents,
        COALESCE(SUM(CASE WHEN event_type = 'refunded' THEN amount_cents ELSE 0 END), 0)::BIGINT AS refunded_cents,
        (
          COALESCE(SUM(CASE WHEN event_type = 'approved' THEN amount_cents ELSE 0 END), 0) -
          COALESCE(SUM(CASE WHEN event_type = 'refunded' THEN amount_cents ELSE 0 END), 0)
        )::BIGINT AS net_cents,
        COUNT(CASE WHEN event_type = 'approved' THEN 1 END)::INT AS sales_count,
        COUNT(CASE WHEN event_type = 'refunded' THEN 1 END)::INT AS refunds_count
      FROM sale_events
      WHERE event_created_at >= $1 AND event_created_at <= $2
      GROUP BY currency
      ORDER BY currency ASC;
    `;

    const totalsResult = await query(totalsSql, [fromDate, toDate]);

    const currencies: CurrencySummary[] = totalsResult.rows.map((row) => ({
      currency: row.currency,
      gross_cents: Number(row.gross_cents),
      refunded_cents: Number(row.refunded_cents),
      net_cents: Number(row.net_cents),
      sales_count: Number(row.sales_count),
      refunds_count: Number(row.refunds_count),
    }));

    // 2. Agrupamentos opcionais (day | product | platform)
    let groups: GroupedSummary[] | undefined;

    if (params.group_by) {
      let groupSql = '';

      if (params.group_by === 'day') {
        groupSql = `
          SELECT
            TO_CHAR(DATE_TRUNC('day', event_created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS group_key,
            currency,
            COALESCE(SUM(CASE WHEN event_type = 'approved' THEN amount_cents ELSE 0 END), 0)::BIGINT AS gross_cents,
            COALESCE(SUM(CASE WHEN event_type = 'refunded' THEN amount_cents ELSE 0 END), 0)::BIGINT AS refunded_cents,
            (
              COALESCE(SUM(CASE WHEN event_type = 'approved' THEN amount_cents ELSE 0 END), 0) -
              COALESCE(SUM(CASE WHEN event_type = 'refunded' THEN amount_cents ELSE 0 END), 0)
            )::BIGINT AS net_cents,
            COUNT(CASE WHEN event_type = 'approved' THEN 1 END)::INT AS sales_count,
            COUNT(CASE WHEN event_type = 'refunded' THEN 1 END)::INT AS refunds_count
          FROM sale_events
          WHERE event_created_at >= $1 AND event_created_at <= $2
          GROUP BY group_key, currency
          ORDER BY group_key ASC, currency ASC;
        `;
      } else if (params.group_by === 'product') {
        groupSql = `
          SELECT
            product_id AS group_key,
            product_name AS group_name,
            currency,
            COALESCE(SUM(CASE WHEN event_type = 'approved' THEN amount_cents ELSE 0 END), 0)::BIGINT AS gross_cents,
            COALESCE(SUM(CASE WHEN event_type = 'refunded' THEN amount_cents ELSE 0 END), 0)::BIGINT AS refunded_cents,
            (
              COALESCE(SUM(CASE WHEN event_type = 'approved' THEN amount_cents ELSE 0 END), 0) -
              COALESCE(SUM(CASE WHEN event_type = 'refunded' THEN amount_cents ELSE 0 END), 0)
            )::BIGINT AS net_cents,
            COUNT(CASE WHEN event_type = 'approved' THEN 1 END)::INT AS sales_count,
            COUNT(CASE WHEN event_type = 'refunded' THEN 1 END)::INT AS refunds_count
          FROM sale_events
          WHERE event_created_at >= $1 AND event_created_at <= $2
          GROUP BY product_id, product_name, currency
          ORDER BY gross_cents DESC, currency ASC;
        `;
      } else if (params.group_by === 'platform') {
        groupSql = `
          SELECT
            platform AS group_key,
            currency,
            COALESCE(SUM(CASE WHEN event_type = 'approved' THEN amount_cents ELSE 0 END), 0)::BIGINT AS gross_cents,
            COALESCE(SUM(CASE WHEN event_type = 'refunded' THEN amount_cents ELSE 0 END), 0)::BIGINT AS refunded_cents,
            (
              COALESCE(SUM(CASE WHEN event_type = 'approved' THEN amount_cents ELSE 0 END), 0) -
              COALESCE(SUM(CASE WHEN event_type = 'refunded' THEN amount_cents ELSE 0 END), 0)
            )::BIGINT AS net_cents,
            COUNT(CASE WHEN event_type = 'approved' THEN 1 END)::INT AS sales_count,
            COUNT(CASE WHEN event_type = 'refunded' THEN 1 END)::INT AS refunds_count
          FROM sale_events
          WHERE event_created_at >= $1 AND event_created_at <= $2
          GROUP BY platform, currency
          ORDER BY gross_cents DESC, currency ASC;
        `;
      }

      if (groupSql) {
        const groupResult = await query(groupSql, [fromDate, toDate]);
        groups = groupResult.rows.map((row) => ({
          group_key: row.group_key,
          group_name: row.group_name || undefined,
          currency: row.currency,
          gross_cents: Number(row.gross_cents),
          refunded_cents: Number(row.refunded_cents),
          net_cents: Number(row.net_cents),
          sales_count: Number(row.sales_count),
          refunds_count: Number(row.refunds_count),
        }));
      }
    }

    return {
      period: {
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        timezone: 'UTC',
      },
      group_by: params.group_by,
      currencies,
      groups,
    };
  }
}
