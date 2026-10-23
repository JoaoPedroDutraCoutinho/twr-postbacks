import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { memoryDb } from '../src/db/memory.js';
import { generateHmacSignature } from '../src/utils/hmac.js';

describe('Suíte de Testes Core: Receptor de Postbacks & Relatórios', () => {
  const app = buildApp();

  beforeEach(() => {
    memoryDb.reset();
  });

  afterEach(async () => {
    memoryDb.reset();
  });

  // Helper para assinar e disparar webhook
  async function postWebhook(payload: any, secret = env.WEBHOOK_SECRET, customSignature?: string) {
    const rawBody = JSON.stringify(payload);
    const signature = customSignature ?? generateHmacSignature(rawBody, secret);

    return app.inject({
      method: 'POST',
      url: '/webhooks/sales',
      headers: {
        'content-type': 'application/json',
        'x-signature': signature,
      },
      payload: rawBody,
    });
  }

  // Helper para buscar relatório
  async function getReport(query = '') {
    return app.inject({
      method: 'GET',
      url: `/reports/sales${query ? `?${query}` : ''}`,
    });
  }

  // CASO 1: Evento duplicado conta uma venda
  it('1. Evento duplicado retorna 200 e conta apenas uma venda no relatório', async () => {
    const payload = {
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
    const res1 = await postWebhook(payload);
    expect(res1.statusCode).toBe(201);
    expect(res1.json().status).toBe('created');

    // Segundo envio idêntico: Duplicado -> 200 OK (idempotente)
    const res2 = await postWebhook(payload);
    expect(res2.statusCode).toBe(200);
    expect(res2.json().status).toBe('duplicate');

    // Validação no relatório: Apenas 1 venda e 15000 centavos
    const reportRes = await getReport();
    expect(reportRes.statusCode).toBe(200);
    const body = reportRes.json();

    expect(body.currencies).toHaveLength(1);
    expect(body.currencies[0]).toEqual({
      currency: 'BRL',
      gross_cents: 15000,
      refunded_cents: 0,
      net_cents: 15000,
      sales_count: 1,
      refunds_count: 0,
    });
  });

  // CASO 2: 20 envios idênticos em paralelo contam uma venda
  it('2. 20 envios concorrentes idênticos registram exatamente uma venda', async () => {
    const payload = {
      platform: 'hotmart',
      event_id: 'evt_parallel_999',
      event_type: 'sale.approved',
      order_id: 'ord_parallel_999',
      product: { id: 'prod_ebook', name: 'E-book Arquitetura' },
      currency: 'BRL',
      amount_cents: 5000,
      customer: { email: 'concorrente@teste.com' },
    };

    // Dispara 20 requisições simultâneas
    const promises = Array.from({ length: 20 }, () => postWebhook(payload));
    const responses = await Promise.all(promises);

    const status201Count = responses.filter((r) => r.statusCode === 201).length;
    const status200Count = responses.filter((r) => r.statusCode === 200).length;

    // Exatamente uma inserção deve ter sido realizada com sucesso (201) e 19 ignoradas (200)
    expect(status201Count).toBe(1);
    expect(status200Count).toBe(19);

    const reportRes = await getReport();
    const brlSummary = reportRes.json().currencies.find((c: any) => c.currency === 'BRL');
    expect(brlSummary.sales_count).toBe(1);
    expect(brlSummary.gross_cents).toBe(5000);
  });

  // CASO 3: Reembolso antes da aprovação gera o mesmo relatório final
  it('3. Reembolso recebido antes ou depois da aprovação gera o mesmo resultado financeiro', async () => {
    // Cenário A: Reembolso chega antes da aprovação (out-of-order)
    const refundOrderA = {
      platform: 'kiwify',
      event_id: 'evt_refund_order_a',
      event_type: 'sale.refunded',
      order_id: 'ord_a',
      product: { id: 'prod_saas', name: 'Plano Pro' },
      currency: 'BRL',
      amount_cents: 20000,
      customer: { email: 'cliente_a@teste.com' },
    };

    const approveOrderA = {
      platform: 'kiwify',
      event_id: 'evt_approved_order_a',
      event_type: 'sale.approved',
      order_id: 'ord_a',
      product: { id: 'prod_saas', name: 'Plano Pro' },
      currency: 'BRL',
      amount_cents: 20000,
      customer: { email: 'cliente_a@teste.com' },
    };

    // 1º Reembolso -> 201
    const resRefund = await postWebhook(refundOrderA);
    expect(resRefund.statusCode).toBe(201);

    // 2º Aprovação posterior -> 201
    const resApprove = await postWebhook(approveOrderA);
    expect(resApprove.statusCode).toBe(201);

    // Relatório final: gross = 20000, refunded = 20000, net = 0
    const reportRes = await getReport();
    const brl = reportRes.json().currencies.find((c: any) => c.currency === 'BRL');

    expect(brl.gross_cents).toBe(20000);
    expect(brl.refunded_cents).toBe(20000);
    expect(brl.net_cents).toBe(0);
    expect(brl.sales_count).toBe(1);
    expect(brl.refunds_count).toBe(1);
  });

  // CASO 4: Payload inválido retorna 422
  it('4. Payload malformado ou campos obrigatórios faltantes retornam 422', async () => {
    // Faltando platform e amount_cents negativo
    const invalidPayload = {
      event_id: 'evt_inv_1',
      event_type: 'sale.approved',
      amount_cents: -500, // Inválido: não pode ser negativo
    };

    const res = await postWebhook(invalidPayload);
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toBe('Unprocessable Entity');
    expect(res.json().issues).toBeDefined();

    // Payload com JSON quebrado
    const rawBrokenJson = '{ "platform": "kiwify", invalid }';
    const brokenSig = generateHmacSignature(rawBrokenJson, env.WEBHOOK_SECRET);
    const brokenRes = await app.inject({
      method: 'POST',
      url: '/webhooks/sales',
      headers: {
        'content-type': 'application/json',
        'x-signature': brokenSig,
      },
      payload: rawBrokenJson,
    });
    expect(brokenRes.statusCode).toBe(422);
  });

  // CASO 5: Assinatura errada retorna 401
  it('5. Assinatura HMAC incorreta ou ausente retorna 401 Unauthorized', async () => {
    const payload = {
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
    const wrongSigRes = await postWebhook(payload, 'wrong_secret_123456');
    expect(wrongSigRes.statusCode).toBe(401);
    expect(wrongSigRes.json().error).toBe('Unauthorized');

    // Sem header X-Signature
    const noSigRes = await app.inject({
      method: 'POST',
      url: '/webhooks/sales',
      headers: {
        'content-type': 'application/json',
      },
      payload: JSON.stringify(payload),
    });
    expect(noSigRes.statusCode).toBe(401);
  });

  // CASO 6: Duas moedas não se misturam
  it('6. Transações em moedas distintas são totalizadas separadamente sem se misturar', async () => {
    // Venda em BRL (R$ 100,00)
    await postWebhook({
      platform: 'kiwify',
      event_id: 'evt_brl_1',
      event_type: 'sale.approved',
      order_id: 'ord_brl',
      product: { id: 'prod_brl', name: 'Produto BR' },
      currency: 'BRL',
      amount_cents: 10000,
      customer: { email: 'br@teste.com' },
    });

    // Venda em USD ($ 50.00)
    await postWebhook({
      platform: 'stripe',
      event_id: 'evt_usd_1',
      event_type: 'sale.approved',
      order_id: 'ord_usd',
      product: { id: 'prod_usd', name: 'Product US' },
      currency: 'USD',
      amount_cents: 5000,
      customer: { email: 'us@teste.com' },
    });

    const reportRes = await getReport();
    expect(reportRes.statusCode).toBe(200);
    const { currencies } = reportRes.json();

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
  it('GET /health retorna 200 e status saudável', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
    expect(res.json().database).toBe('connected');
  });

  // Teste Adicional: Agrupamento por produto e plataforma
  it('GET /reports/sales com group_by=product agrupa corretamente', async () => {
    await postWebhook({
      platform: 'kiwify',
      event_id: 'evt_group_1',
      event_type: 'sale.approved',
      order_id: 'ord_g1',
      product: { id: 'prod_alpha', name: 'Curso Alpha' },
      currency: 'BRL',
      amount_cents: 8000,
      customer: { email: 'a@teste.com' },
    });

    await postWebhook({
      platform: 'kiwify',
      event_id: 'evt_group_2',
      event_type: 'sale.approved',
      order_id: 'ord_g2',
      product: { id: 'prod_beta', name: 'Curso Beta' },
      currency: 'BRL',
      amount_cents: 12000,
      customer: { email: 'b@teste.com' },
    });

    const reportRes = await getReport('group_by=product');
    expect(reportRes.statusCode).toBe(200);
    const { groups } = reportRes.json();

    expect(groups).toHaveLength(2);
    expect(groups.some((g: any) => g.group_key === 'prod_alpha' && g.gross_cents === 8000)).toBe(true);
    expect(groups.some((g: any) => g.group_key === 'prod_beta' && g.gross_cents === 12000)).toBe(true);
  });
});
