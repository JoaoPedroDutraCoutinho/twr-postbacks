import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { memoryDb } from '../src/db/memory.js';
import { generateHmacSignature } from '../src/utils/hmac.js';

describe('Suite de Testes Core: Receptor de Postbacks & Relatorios', () => {
  const aplicacao = buildApp();

  beforeEach(() => {
    memoryDb.reset();
  });

  afterEach(async () => {
    memoryDb.reset();
  });

  async function enviar_webhook(dados_payload: any, segredo = env.WEBHOOK_SECRET, assinatura_customizada?: string) {
    const corpo_bruto = JSON.stringify(dados_payload);
    const assinatura = assinatura_customizada ?? generateHmacSignature(corpo_bruto, segredo);

    return aplicacao.inject({
      method: 'POST',
      url: '/webhooks/sales',
      headers: {
        'content-type': 'application/json',
        'x-signature': assinatura,
      },
      payload: corpo_bruto,
    });
  }

  async function buscar_relatorio(parametros_consulta = '') {
    return aplicacao.inject({
      method: 'GET',
      url: `/reports/sales${parametros_consulta ? `?${parametros_consulta}` : ''}`,
    });
  }

  it('1. Evento duplicado retorna 200 e conta apenas uma venda no relatorio', async () => {
    const dados_venda = {
      platform: 'kiwify',
      event_id: 'evt_dup_101',
      event_type: 'sale.approved',
      order_id: 'ord_101',
      product: { id: 'prod_course', name: 'Curso TypeScript' },
      currency: 'BRL',
      amount_cents: 15000,
      customer: { email: 'aluno@teste.com' },
    };

    // Primeiro envio: Novo evento -> 201 Created
    const resposta_1 = await enviar_webhook(dados_venda);
    expect(resposta_1.statusCode).toBe(201);
    expect(resposta_1.json().status).toBe('created');

    // Segundo envio identico: Duplicado -> 200 OK (idempotente)
    const resposta_2 = await enviar_webhook(dados_venda);
    expect(resposta_2.statusCode).toBe(200);
    expect(resposta_2.json().status).toBe('duplicate');

    // Validacao no relatorio: Apenas 1 venda e 15000 centavos
    const resposta_relatorio = await buscar_relatorio();
    expect(resposta_relatorio.statusCode).toBe(200);
    const corpo_relatorio = resposta_relatorio.json();

    expect(corpo_relatorio.currencies).toHaveLength(1);
    expect(corpo_relatorio.currencies[0]).toEqual({
      currency: 'BRL',
      gross_cents: 15000,
      refunded_cents: 0,
      net_cents: 15000,
      sales_count: 1,
      refunds_count: 0,
    });
  });

  it('2. 20 envios concorrentes identicos registram exatamente uma venda', async () => {
    const dados_venda = {
      platform: 'hotmart',
      event_id: 'evt_parallel_999',
      event_type: 'sale.approved',
      order_id: 'ord_parallel_999',
      product: { id: 'prod_ebook', name: 'E-book Arquitetura' },
      currency: 'BRL',
      amount_cents: 5000,
      customer: { email: 'concorrente@teste.com' },
    };

    const lista_promessas = Array.from({ length: 20 }, () => enviar_webhook(dados_venda));
    const lista_respostas = await Promise.all(lista_promessas);

    const contagem_status_201 = lista_respostas.filter((r) => r.statusCode === 201).length;
    const contagem_status_200 = lista_respostas.filter((r) => r.statusCode === 200).length;

    expect(contagem_status_201).toBe(1);
    expect(contagem_status_200).toBe(19);

    const resposta_relatorio = await buscar_relatorio();
    const resumo_brl = resposta_relatorio.json().currencies.find((c: any) => c.currency === 'BRL');
    expect(resumo_brl.sales_count).toBe(1);
    expect(resumo_brl.gross_cents).toBe(5000);
  });

  it('3. Reembolso recebido antes ou depois da aprovacao gera o mesmo resultado financeiro', async () => {
    const reembolso_pedido_a = {
      platform: 'kiwify',
      event_id: 'evt_refund_order_a',
      event_type: 'sale.refunded',
      order_id: 'ord_a',
      product: { id: 'prod_saas', name: 'Plano Pro' },
      currency: 'BRL',
      amount_cents: 20000,
      customer: { email: 'cliente_a@teste.com' },
    };

    const aprovacao_pedido_a = {
      platform: 'kiwify',
      event_id: 'evt_approved_order_a',
      event_type: 'sale.approved',
      order_id: 'ord_a',
      product: { id: 'prod_saas', name: 'Plano Pro' },
      currency: 'BRL',
      amount_cents: 20000,
      customer: { email: 'cliente_a@teste.com' },
    };

    // 1o Reembolso -> 201
    const res_reembolso = await enviar_webhook(reembolso_pedido_a);
    expect(res_reembolso.statusCode).toBe(201);

    // 2o Aprovacao posterior -> 201
    const res_aprovacao = await enviar_webhook(aprovacao_pedido_a);
    expect(res_aprovacao.statusCode).toBe(201);

    // Relatorio final: gross = 20000, refunded = 20000, net = 0
    const resposta_relatorio = await buscar_relatorio();
    const brl = resposta_relatorio.json().currencies.find((c: any) => c.currency === 'BRL');

    expect(brl.gross_cents).toBe(20000);
    expect(brl.refunded_cents).toBe(20000);
    expect(brl.net_cents).toBe(0);
    expect(brl.sales_count).toBe(1);
    expect(brl.refunds_count).toBe(1);
  });

  it('4. Payload malformado ou campos obrigatorios faltantes retornam 422', async () => {
    const payload_invalido = {
      event_id: 'evt_inv_1',
      event_type: 'sale.approved',
      amount_cents: -500,
    };

    const resposta = await enviar_webhook(payload_invalido);
    expect(resposta.statusCode).toBe(422);
    expect(resposta.json().error).toBe('Unprocessable Entity');
    expect(resposta.json().issues).toBeDefined();

    const json_bruto_quebrado = '{ "platform": "kiwify", invalid }';
    const assinatura_quebrada = generateHmacSignature(json_bruto_quebrado, env.WEBHOOK_SECRET);
    const resposta_quebrada = await aplicacao.inject({
      method: 'POST',
      url: '/webhooks/sales',
      headers: {
        'content-type': 'application/json',
        'x-signature': assinatura_quebrada,
      },
      payload: json_bruto_quebrado,
    });
    expect(resposta_quebrada.statusCode).toBe(422);
    expect(resposta_quebrada.json().error).toBe('Unprocessable Entity');

    // JSON quebrado SEM assinatura valida: a assinatura e checada primeiro -> 401
    const resposta_quebrada_sem_assinatura = await aplicacao.inject({
      method: 'POST',
      url: '/webhooks/sales',
      headers: {
        'content-type': 'application/json',
        'x-signature': 'abc123',
      },
      payload: json_bruto_quebrado,
    });
    expect(resposta_quebrada_sem_assinatura.statusCode).toBe(401);
  });

  it('5. Assinatura HMAC incorreta ou ausente retorna 401 Unauthorized', async () => {
    const dados_venda = {
      platform: 'kiwify',
      event_id: 'evt_sec_1',
      event_type: 'sale.approved',
      order_id: 'ord_sec',
      product: { id: 'prod_sec', name: 'Curso' },
      currency: 'BRL',
      amount_cents: 1000,
      customer: { email: 'sec@teste.com' },
    };

    // Assinatura gerada com segredo errado
    const resposta_assinatura_errada = await enviar_webhook(dados_venda, 'wrong_secret_123456');
    expect(resposta_assinatura_errada.statusCode).toBe(401);
    expect(resposta_assinatura_errada.json().error).toBe('Unauthorized');

    const resposta_sem_assinatura = await aplicacao.inject({
      method: 'POST',
      url: '/webhooks/sales',
      headers: {
        'content-type': 'application/json',
      },
      payload: JSON.stringify(dados_venda),
    });
    expect(resposta_sem_assinatura.statusCode).toBe(401);
  });

  it('6. Transacoes em moedas distintas sao totalizadas separadamente sem se misturar', async () => {
    await enviar_webhook({
      platform: 'kiwify',
      event_id: 'evt_brl_1',
      event_type: 'sale.approved',
      order_id: 'ord_brl',
      product: { id: 'prod_brl', name: 'Produto BR' },
      currency: 'BRL',
      amount_cents: 10000,
      customer: { email: 'br@teste.com' },
    });

    await enviar_webhook({
      platform: 'stripe',
      event_id: 'evt_usd_1',
      event_type: 'sale.approved',
      order_id: 'ord_usd',
      product: { id: 'prod_usd', name: 'Product US' },
      currency: 'USD',
      amount_cents: 5000,
      customer: { email: 'us@teste.com' },
    });

    const resposta_relatorio = await buscar_relatorio();
    expect(resposta_relatorio.statusCode).toBe(200);
    const { currencies } = resposta_relatorio.json();

    expect(currencies).toHaveLength(2);

    const brl = currencies.find((c: any) => c.currency === 'BRL');
    const usd = currencies.find((c: any) => c.currency === 'USD');

    expect(brl).toEqual({
      currency: 'BRL',
      gross_cents: 10000,
      refunded_cents: 0,
      net_cents: 10000,
      sales_count: 1,
      refunds_count: 0,
    });

    expect(usd).toEqual({
      currency: 'USD',
      gross_cents: 5000,
      refunded_cents: 0,
      net_cents: 5000,
      sales_count: 1,
      refunds_count: 0,
    });
  });

  // Teste Adicional: Health check
  it('GET /health retorna 200 e status saudavel', async () => {
    const resposta = await aplicacao.inject({
      method: 'GET',
      url: '/health',
    });
    expect(resposta.statusCode).toBe(200);
    expect(resposta.json().status).toBe('ok');
    expect(resposta.json().database).toBe('connected');
  });

  // Teste Adicional: Agrupamento por produto e plataforma
  it('GET /reports/sales com group_by=product agrupa corretamente', async () => {
    await enviar_webhook({
      platform: 'kiwify',
      event_id: 'evt_group_1',
      event_type: 'sale.approved',
      order_id: 'ord_g1',
      product: { id: 'prod_alpha', name: 'Curso Alpha' },
      currency: 'BRL',
      amount_cents: 8000,
      customer: { email: 'a@teste.com' },
    });

    await enviar_webhook({
      platform: 'kiwify',
      event_id: 'evt_group_2',
      event_type: 'sale.approved',
      order_id: 'ord_g2',
      product: { id: 'prod_beta', name: 'Curso Beta' },
      currency: 'BRL',
      amount_cents: 12000,
      customer: { email: 'b@teste.com' },
    });

    const resposta_relatorio = await buscar_relatorio('group_by=product');
    expect(resposta_relatorio.statusCode).toBe(200);
    const { groups } = resposta_relatorio.json();

    expect(groups).toHaveLength(2);
    expect(groups.some((g: any) => g.group_key === 'prod_alpha' && g.gross_cents === 8000)).toBe(true);
    expect(groups.some((g: any) => g.group_key === 'prod_beta' && g.gross_cents === 12000)).toBe(true);
  });

  // Teste Adicional: Observabilidade
  it('GET /metrics conta webhooks por resultado no formato Prometheus', async () => {
    async function ler_contador_webhooks(resultado: string): Promise<number> {
      const resposta = await aplicacao.inject({ method: 'GET', url: '/metrics' });
      const linha = resposta.body
        .split('\n')
        .find((l) => l.startsWith(`twr_webhooks_received_total{result="${resultado}"}`));
      return Number(linha?.split(' ').pop() ?? NaN);
    }

    const antes = {
      created: await ler_contador_webhooks('created'),
      duplicate: await ler_contador_webhooks('duplicate'),
      unauthorized: await ler_contador_webhooks('unauthorized'),
    };

    const dados_venda = {
      platform: 'kiwify',
      event_id: 'evt_metrics_1',
      event_type: 'sale.approved',
      order_id: 'ord_metrics_1',
      product: { id: 'prod_metrics', name: 'Curso Metricas' },
      currency: 'BRL',
      amount_cents: 3000,
      customer: { email: 'metricas@teste.com' },
    };

    await enviar_webhook(dados_venda);
    await enviar_webhook(dados_venda);
    await enviar_webhook(dados_venda, 'segredo_errado_123456');

    expect(await ler_contador_webhooks('created')).toBe(antes.created + 1);
    expect(await ler_contador_webhooks('duplicate')).toBe(antes.duplicate + 1);
    expect(await ler_contador_webhooks('unauthorized')).toBe(antes.unauthorized + 1);

    const resposta_metricas = await aplicacao.inject({ method: 'GET', url: '/metrics' });
    expect(resposta_metricas.statusCode).toBe(200);
    expect(resposta_metricas.headers['content-type']).toContain('text/plain');
    expect(resposta_metricas.body).toContain('twr_http_request_duration_seconds_bucket');
    expect(resposta_metricas.body).toContain('route="/webhooks/sales"');
  });
});
