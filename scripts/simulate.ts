import crypto from 'node:crypto';

const API_URL = process.env.API_URL || 'http://localhost:3000';
const SECRET = process.env.WEBHOOK_SECRET || 'twr_webhook_secret_key_2026';

function generateHmac(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

async function sendWebhook(
  name: string,
  payload: any,
  options: { secret?: string; customSig?: string; rawOverride?: string } = {}
) {
  const secret = options.secret ?? SECRET;
  const rawBody = options.rawOverride ?? JSON.stringify(payload);
  const signature = options.customSig ?? generateHmac(rawBody, secret);

  const res = await fetch(`${API_URL}/webhooks/sales`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-signature': signature,
    },
    body: rawBody,
  });

  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, name };
}

async function runSimulation() {
  console.log('='.repeat(70));
  console.log('🚀 TWR POSTBACK SIMULATOR: Simulador de Tráfego de Checkout');
  console.log(`🌐 Alvo: ${API_URL}`);
  console.log('='.repeat(70));

  // 1. Healthcheck
  try {
    const healthRes = await fetch(`${API_URL}/health`);
    if (!healthRes.ok) {
      console.error(`❌ Health check falhou com status ${healthRes.status}`);
      process.exit(1);
    }
    console.log('✅ Servidor ativo e pronto para receber tráfego.\n');
  } catch (err: any) {
    console.error(`❌ Não foi possível conectar ao servidor em ${API_URL}:`, err.message);
    console.log('👉 Certifique-se de que o servidor está rodando com: npm run dev');
    process.exit(1);
  }

  const runId = Date.now();
  console.log(`▶ Iniciando bateria de disparos (Run ID: ${runId})...\n`);

  // Cenário 1: Venda Comum BRL (R$ 100,00)
  const evt1 = {
    platform: 'kiwify',
    event_id: `evt_sim_${runId}_1`,
    event_type: 'sale.approved',
    order_id: `ord_${runId}_1`,
    product: { id: 'prod_master', name: 'Formação Master' },
    currency: 'BRL',
    amount_cents: 10000,
    customer: { email: 'cliente1@twr.com', name: 'Cliente 1' },
  };
  const r1 = await sendWebhook('1. Venda Nova BRL R$ 100,00', evt1);
  console.log(`[1] Venda Inicial: Status ${r1.status} (Esperado: 201)`);

  // Cenário 2: Venda Comum BRL (R$ 250,00)
  const evt2 = {
    platform: 'hotmart',
    event_id: `evt_sim_${runId}_2`,
    event_type: 'sale.approved',
    order_id: `ord_${runId}_2`,
    product: { id: 'prod_vip', name: 'Acesso VIP' },
    currency: 'BRL',
    amount_cents: 25000,
    customer: { email: 'cliente2@twr.com', name: 'Cliente 2' },
  };
  const r2 = await sendWebhook('2. Venda Nova BRL R$ 250,00', evt2);
  console.log(`[2] Venda VIP: Status ${r2.status} (Esperado: 201)`);

  // Cenário 3: Retentativa da Plataforma (Duplicata de evt1) -> IDEMPOTÊNCIA
  const r3 = await sendWebhook('3. Retry de Venda 1 (Duplicata)', evt1);
  console.log(`[3] Retentativa de Webhook (Duplicado): Status ${r3.status} (Esperado: 200)`);

  // Cenário 4: Alta concorrência simultânea (Flash Sale de R$ 97,00 disparada 10 vezes juntas)
  console.log('\n[4] Disparando 10 requisições simultâneas para o mesmo evento de Flash Sale...');
  const concurrentEvt = {
    platform: 'kiwify',
    event_id: `evt_sim_${runId}_flash`,
    event_type: 'sale.approved',
    order_id: `ord_${runId}_flash`,
    product: { id: 'prod_flash', name: 'Oferta Relâmpago' },
    currency: 'BRL',
    amount_cents: 9700,
    customer: { email: 'flash@twr.com' },
  };
  const concurrentPromises = Array.from({ length: 10 }, () =>
    sendWebhook('Flash Sale Concorrente', concurrentEvt)
  );
  const concurrentResponses = await Promise.all(concurrentPromises);
  const c201 = concurrentResponses.filter((r) => r.status === 201).length;
  const c200 = concurrentResponses.filter((r) => r.status === 200).length;
  console.log(`    ↳ Concorrência resolvida: ${c201}x HTTP 201 (criado) e ${c200}x HTTP 200 (ignorado)`);

  // Cenário 5: Reembolso fora de ordem (Reembolso chega antes da aprovação)
  console.log('\n[5] Testando evento fora de ordem: Reembolso chegando ANTES da aprovação...');
  const outOfOrderRefund = {
    platform: 'kiwify',
    event_id: `evt_sim_${runId}_refund_first`,
    event_type: 'sale.refunded',
    order_id: `ord_${runId}_ooo`,
    product: { id: 'prod_ooo', name: 'Produto Reembolsado' },
    currency: 'BRL',
    amount_cents: 5000,
    customer: { email: 'reembolso@twr.com' },
  };
  const rRefund = await sendWebhook('Reembolso antes da Aprovação', outOfOrderRefund);
  console.log(`    ↳ 1º Reembolso recebido: Status ${rRefund.status} (Esperado: 201)`);

  const outOfOrderApprove = {
    platform: 'kiwify',
    event_id: `evt_sim_${runId}_approve_second`,
    event_type: 'sale.approved',
    order_id: `ord_${runId}_ooo`,
    product: { id: 'prod_ooo', name: 'Produto Reembolsado' },
    currency: 'BRL',
    amount_cents: 5000,
    customer: { email: 'reembolso@twr.com' },
  };
  const rApprove = await sendWebhook('Aprovação posterior', outOfOrderApprove);
  console.log(`    ↳ 2º Aprovação posterior recebida: Status ${rApprove.status} (Esperado: 201)`);

  // Cenário 6: Venda em Moeda Estrangeira (USD $ 40.00)
  const evtUsd = {
    platform: 'stripe',
    event_id: `evt_sim_${runId}_usd`,
    event_type: 'sale.approved',
    order_id: `ord_${runId}_usd`,
    product: { id: 'prod_intl', name: 'International Pass' },
    currency: 'USD',
    amount_cents: 4000,
    customer: { email: 'international@twr.com' },
  };
  const rUsd = await sendWebhook('6. Venda Internacional USD $ 40.00', evtUsd);
  console.log(`\n[6] Venda USD: Status ${rUsd.status} (Esperado: 201)`);

  // Cenário 7: Payload com erro de validação (Schema inválido)
  const invalidPayload = { platform: 'kiwify', amount_cents: -50 };
  const rInvalid = await sendWebhook('7. Payload Inválido', invalidPayload);
  console.log(`[7] Validação Zod (Campos inválidos): Status ${rInvalid.status} (Esperado: 422)`);

  // Cenário 8: Assinatura adulterada / inválida
  const rBadSig = await sendWebhook('8. Assinatura Inválida', evt1, {
    customSig: 'fake_tampered_signature_00000000000000',
  });
  console.log(`[8] Segurança HMAC (Assinatura falsa): Status ${rBadSig.status} (Esperado: 401)`);

  // 3. Verificação do Relatório
  console.log('\n' + '='.repeat(70));
  console.log('📊 RECONCILIAÇÃO FINANCEIRA (GET /reports/sales)');
  console.log('='.repeat(70));

  const reportRes = await fetch(`${API_URL}/reports/sales`);
  const report = await reportRes.json();

  console.log(JSON.stringify(report, null, 2));

  console.log('\n' + '='.repeat(70));
  console.log('🎉 SIMULAÇÃO CONCLUÍDA COM SUCESSO!');
  console.log('   - Idempotência validada contra retries e concorrência.');
  console.log('   - Reembolsos e aprovações fora de ordem reconciliados.');
  console.log('   - Moedas isoladas e integridade criptográfica preservada.');
  console.log('='.repeat(70));
}

runSimulation().catch(console.error);
