import { isMemoryDb, query } from '../db/index.js';
import { memoryDb } from '../db/memory.js';
import {
  CurrencySummary,
  GroupedSummary,
  ReportQueryParams,
  SalesReportResponse,
} from '../schemas/report.schema.js';

const COLUNAS_METRICAS = `
  COALESCE(SUM(CASE WHEN event_type = 'approved' THEN amount_cents ELSE 0 END), 0)::BIGINT AS gross_cents,
  COALESCE(SUM(CASE WHEN event_type = 'refunded' THEN amount_cents ELSE 0 END), 0)::BIGINT AS refunded_cents,
  (
    COALESCE(SUM(CASE WHEN event_type = 'approved' THEN amount_cents ELSE 0 END), 0) -
    COALESCE(SUM(CASE WHEN event_type = 'refunded' THEN amount_cents ELSE 0 END), 0)
  )::BIGINT AS net_cents,
  COUNT(CASE WHEN event_type = 'approved' THEN 1 END)::INT AS sales_count,
  COUNT(CASE WHEN event_type = 'refunded' THEN 1 END)::INT AS refunds_count
`;

// Lista fixa de agrupamentos: nenhum valor vindo da query string e concatenado no SQL
const AGRUPAMENTOS = {
  day: {
    colunas: `TO_CHAR(DATE_TRUNC('day', event_created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS group_key`,
    agrupar_por: 'group_key',
    ordenar_por: 'group_key ASC, currency ASC',
  },
  product: {
    colunas: 'product_id AS group_key, product_name AS group_name',
    agrupar_por: 'product_id, product_name',
    ordenar_por: 'gross_cents DESC, currency ASC',
  },
  platform: {
    colunas: 'platform AS group_key',
    agrupar_por: 'platform',
    ordenar_por: 'gross_cents DESC, currency ASC',
  },
} as const;

function converter_metricas(linha: any): CurrencySummary {
  return {
    currency: linha.currency,
    gross_cents: Number(linha.gross_cents),
    refunded_cents: Number(linha.refunded_cents),
    net_cents: Number(linha.net_cents),
    sales_count: Number(linha.sales_count),
    refunds_count: Number(linha.refunds_count),
  };
}

export class ReportService {
  async obter_relatorio_vendas(parametros: ReportQueryParams): Promise<SalesReportResponse> {
    const data_fim = parametros.to ? new Date(parametros.to) : new Date();
    const data_inicio = parametros.from
      ? new Date(parametros.from)
      : new Date(data_fim.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 dias atras

    const periodo = {
      from: data_inicio.toISOString(),
      to: data_fim.toISOString(),
      timezone: 'UTC',
    };

    // Se estiver em modo de teste ou banco em memoria
    if (isMemoryDb()) {
      return {
        period: periodo,
        group_by: parametros.group_by,
        currencies: memoryDb.obter_totais(data_inicio, data_fim),
        groups: parametros.group_by
          ? memoryDb.obter_agrupados(data_inicio, data_fim, parametros.group_by)
          : undefined,
      };
    }

    // 1. Totais consolidados por moeda
    const sql_totais = `
      SELECT currency, ${COLUNAS_METRICAS}
      FROM sale_events
      WHERE event_created_at >= $1 AND event_created_at <= $2
      GROUP BY currency
      ORDER BY currency ASC;
    `;

    const resultado_totais = await query(sql_totais, [data_inicio, data_fim]);
    const currencies = resultado_totais.rows.map(converter_metricas);

    // 2. Agrupamento opcional (day | product | platform)
    let groups: GroupedSummary[] | undefined;

    if (parametros.group_by) {
      const agrupamento = AGRUPAMENTOS[parametros.group_by];
      const sql_agrupamento = `
        SELECT ${agrupamento.colunas}, currency, ${COLUNAS_METRICAS}
        FROM sale_events
        WHERE event_created_at >= $1 AND event_created_at <= $2
        GROUP BY ${agrupamento.agrupar_por}, currency
        ORDER BY ${agrupamento.ordenar_por};
      `;

      const resultado_agrupamento = await query(sql_agrupamento, [data_inicio, data_fim]);
      groups = resultado_agrupamento.rows.map((linha) => ({
        group_key: linha.group_key,
        group_name: linha.group_name || undefined,
        ...converter_metricas(linha),
      }));
    }

    return {
      period: periodo,
      group_by: parametros.group_by,
      currencies,
      groups,
    };
  }
}
