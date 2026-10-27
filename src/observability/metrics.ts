import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import { pool } from '../db/index.js';

const RESULTADO_POR_STATUS: Record<number, string> = {
  200: 'duplicate',
  201: 'created',
  401: 'unauthorized',
  422: 'invalid',
  429: 'rate_limited',
};

export function criar_metricas() {
  const registro = new Registry();
  collectDefaultMetrics({ register: registro });

  const webhooks_recebidos = new Counter({
    name: 'twr_webhooks_received_total',
    help: 'Webhooks recebidos em POST /webhooks/sales, por resultado do processamento',
    labelNames: ['result'] as const,
    registers: [registro],
  });

  const duracao_requisicoes = new Histogram({
    name: 'twr_http_request_duration_seconds',
    help: 'Duracao das requisicoes HTTP em segundos',
    labelNames: ['method', 'route', 'status_code'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    registers: [registro],
  });

  new Gauge({
    name: 'twr_db_pool_connections',
    help: 'Conexoes do pool do PostgreSQL por estado',
    labelNames: ['state'] as const,
    registers: [registro],
    collect() {
      this.set({ state: 'total' }, pool.totalCount);
      this.set({ state: 'idle' }, pool.idleCount);
      this.set({ state: 'waiting' }, pool.waitingCount);
    },
  });

  // Series zeradas desde o primeiro scrape, para alertas do tipo rate() funcionarem logo de inicio
  for (const resultado of new Set(Object.values(RESULTADO_POR_STATUS))) {
    webhooks_recebidos.inc({ result: resultado }, 0);
  }

  return {
    registro,
    observar_resposta(metodo: string, rota: string | undefined, status: number, duracao_ms: number) {
      // Rotas inexistentes viram um unico label, para URLs aleatorias nao explodirem a cardinalidade
      duracao_requisicoes.observe(
        { method: metodo, route: rota ?? 'nao_encontrada', status_code: String(status) },
        duracao_ms / 1000
      );

      if (metodo === 'POST' && rota === '/webhooks/sales') {
        const resultado = RESULTADO_POR_STATUS[status] ?? (status >= 500 ? 'error' : 'other');
        webhooks_recebidos.inc({ result: resultado });
      }
    },
  };
}

export type Metricas = ReturnType<typeof criar_metricas>;
