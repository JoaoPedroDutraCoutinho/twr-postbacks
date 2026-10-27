import { isMemoryDb, query } from '../db/index.js';
import { memoryDb } from '../db/memory.js';
import {
  CurrencySummary,
  GroupedSummary,
  ReportQueryParams,
  SalesReportResponse,
} from '../schemas/report.schema.js';

export class ReportService {
  async obter_relatorio_vendas(parametros: ReportQueryParams): Promise<SalesReportResponse> {
    const data_fim = parametros.to ? new Date(parametros.to) : new Date();
    const data_inicio = parametros.from
      ? new Date(parametros.from)
      : new Date(data_fim.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 dias atras

    // Se estiver em modo de teste ou banco em memoria
    if (isMemoryDb()) {
      const moedas_consolidadas = memoryDb.obter_totais(data_inicio, data_fim);
      const grupos_consolidados = parametros.group_by
        ? memoryDb.obter_agrupados(data_inicio, data_fim, parametros.group_by)
        : undefined;

      return {
        period: {
          from: data_inicio.toISOString(),
          to: data_fim.toISOString(),
          timezone: 'UTC',
        },
        group_by: parametros.group_by,
        currencies: moedas_consolidadas,
        groups: grupos_consolidados,
      };
    }

    // 1. Totais consolidados por moeda
    const sql_totais = `
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

    const resultado_totais = await query(sql_totais, [data_inicio, data_fim]);

    const currencies: CurrencySummary[] = resultado_totais.rows.map((linha) => ({
      currency: linha.currency,
      gross_cents: Number(linha.gross_cents),
      refunded_cents: Number(linha.refunded_cents),
      net_cents: Number(linha.net_cents),
      sales_count: Number(linha.sales_count),
      refunds_count: Number(linha.refunds_count),
    }));

    // 2. Agrupamentos opcionais (day | product | platform)
    let groups: GroupedSummary[] | undefined;

    if (parametros.group_by) {
      let sql_agrupamento = '';

      if (parametros.group_by === 'day') {
        sql_agrupamento = `
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
      } else if (parametros.group_by === 'product') {
        sql_agrupamento = `
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
      } else if (parametros.group_by === 'platform') {
        sql_agrupamento = `
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

      if (sql_agrupamento) {
        const resultado_agrupamento = await query(sql_agrupamento, [data_inicio, data_fim]);
        groups = resultado_agrupamento.rows.map((linha) => ({
          group_key: linha.group_key,
          group_name: linha.group_name || undefined,
          currency: linha.currency,
          gross_cents: Number(linha.gross_cents),
          refunded_cents: Number(linha.refunded_cents),
          net_cents: Number(linha.net_cents),
          sales_count: Number(linha.sales_count),
          refunds_count: Number(linha.refunds_count),
        }));
      }
    }

    return {
      period: {
        from: data_inicio.toISOString(),
        to: data_fim.toISOString(),
        timezone: 'UTC',
      },
      group_by: parametros.group_by,
      currencies,
      groups,
    };
  }

  async getSalesReport(params: ReportQueryParams): Promise<SalesReportResponse> {
    return this.obter_relatorio_vendas(params);
  }
}
