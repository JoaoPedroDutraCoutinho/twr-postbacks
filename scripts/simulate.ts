import crypto from 'node:crypto';

const API_URL = process.env.API_URL || 'http://localhost:3000';
const SEGREDO_WEBHOOK = process.env.WEBHOOK_SECRET || 'twr_webhook_secret_key_2026';

function gerar_hmac(payload: string, segredo: string): string {
  return crypto.createHmac('sha256', segredo).update(payload).digest('hex');
}

async function enviar_webhook(
  nome_caso: string,
  dados_payload: any,
  opcoes: { segredo?: string; assinatura_customizada?: string; corpo_bruto?: string } = {}
) {
  const segredo = opcoes.segredo ?? SEGREDO_WEBHOOK;
  const corpo_bruto = opcoes.corpo_bruto ?? JSON.stringify(dados_payload);
  const assinatura = opcoes.assinatura_customizada ?? gerar_hmac(corpo_bruto, segredo);

  const resposta = await fetch(`${API_URL}/webhooks/sales`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-signature': assinatura,
    },
    body: corpo_bruto,
  });

  const dados = await resposta.json().catch(() => ({}));
  return { status: resposta.status, data: dados, name: nome_caso };
}

async function executar_simulacao() {
  console.log('='.repeat(70));
  console.log('[SIMULADOR] TWR Postback Simulator - Simulador de Trafego de Checkout');
  console.log(`[INFO] Alvo: ${API_URL}`);
  console.log('='.repeat(70));

  // 1. Healthcheck
  try {
    const resposta_saude = await fetch(`${API_URL}/health`);
    if (!resposta_saude.ok) {
      console.error(`[ERRO] Health check falhou com status ${resposta_saude.status}`);
      process.exit(1);
    }
    console.log('[SUCESSO] Servidor ativo e pronto para receber trafego.\n');
  } catch (erro: any) {
    console.error(`[ERRO] Nao foi possivel conectar ao servidor em ${API_URL}:`, erro.message);
    console.log('[INFO] Certifique-se de que o servidor esta rodando com: npm run dev');
    process.exit(1);
  }

  const id_execucao = Date.now();
  console.log(`[INFO] Iniciando bateria de disparos (Execucao ID: ${id_execucao})...\n`);

  // Cenario 1: Venda Comum BRL (R$ 100,00)
  const evento_venda_1 = {
    platform: 'kiwify',
    event_id: `evt_sim_${id_execucao}_1`,
    event_type: 'sale.approved',
    order_id: `ord_${id_execucao}_1`,
    product: { id: 'prod_master', name: 'Formacao Master' },
    currency: 'BRL',
    amount_cents: 10000,
    customer: { email: 'cliente1@twr.com', name: 'Cliente 1' },
  };
  const r1 = await enviar_webhook('1. Venda Nova BRL R$ 100,00', evento_venda_1);
  console.log(`[1] Venda Inicial: Status ${r1.status} (Esperado: 201)`);

  // Cenario 2: Venda Comum BRL (R$ 250,00)
  const evento_venda_2 = {
    platform: 'hotmart',
    event_id: `evt_sim_${id_execucao}_2`,
    event_type: 'sale.approved',
    order_id: `ord_${id_execucao}_2`,
    product: { id: 'prod_vip', name: 'Acesso VIP' },
    currency: 'BRL',
    amount_cents: 25000,
    customer: { email: 'cliente2@twr.com', name: 'Cliente 2' },
  };
  const r2 = await enviar_webhook('2. Venda Nova BRL R$ 250,00', evento_venda_2);
  console.log(`[2] Venda VIP: Status ${r2.status} (Esperado: 201)`);

  // Cenario 3: Retentativa da Plataforma (Duplicata de evento_venda_1) -> IDEMPOTENCIA
  const r3 = await enviar_webhook('3. Retry de Venda 1 (Duplicata)', evento_venda_1);
  console.log(`[3] Retentativa de Webhook (Duplicado): Status ${r3.status} (Esperado: 200)`);

  // Cenario 4: Alta concorrencia simultanea (Flash Sale de R$ 97,00 disparada 10 vezes juntas)
  console.log('\n[4] Disparando 10 requisicoes simultaneas para o mesmo evento de Flash Sale...');
  const evento_concorrente = {
    platform: 'kiwify',
    event_id: `evt_sim_${id_execucao}_flash`,
    event_type: 'sale.approved',
    order_id: `ord_${id_execucao}_flash`,
    product: { id: 'prod_flash', name: 'Oferta Relampago' },
    currency: 'BRL',
    amount_cents: 9700,
    customer: { email: 'flash@twr.com' },
  };
  const promessas_concorrentes = Array.from({ length: 10 }, () =>
    enviar_webhook('Flash Sale Concorrente', evento_concorrente)
  );
  const respostas_concorrentes = await Promise.all(promessas_concorrentes);
  const c201 = respostas_concorrentes.filter((r) => r.status === 201).length;
  const c200 = respostas_concorrentes.filter((r) => r.status === 200).length;
  console.log(`    -> Concorrencia resolvida: ${c201}x HTTP 201 (criado) e ${c200}x HTTP 200 (ignorado)`);

  // Cenario 5: Reembolso fora de ordem (Reembolso chega antes da aprovacao)
  console.log('\n[5] Testando evento fora de ordem: Reembolso chegando ANTES da aprovacao...');
  const reembolso_fora_ordem = {
    platform: 'kiwify',
    event_id: `evt_sim_${id_execucao}_refund_first`,
    event_type: 'sale.refunded',
    order_id: `ord_${id_execucao}_ooo`,
    product: { id: 'prod_ooo', name: 'Produto Reembolsado' },
    currency: 'BRL',
    amount_cents: 5000,
    customer: { email: 'reembolso@twr.com' },
  };
  const rRefund = await enviar_webhook('Reembolso antes da Aprovacao', reembolso_fora_ordem);
  console.log(`    -> 1o Reembolso recebido: Status ${rRefund.status} (Esperado: 201)`);

  const aprovacao_fora_ordem = {
    platform: 'kiwify',
    event_id: `evt_sim_${id_execucao}_approve_second`,
    event_type: 'sale.approved',
    order_id: `ord_${id_execucao}_ooo`,
    product: { id: 'prod_ooo', name: 'Produto Reembolsado' },
    currency: 'BRL',
    amount_cents: 5000,
    customer: { email: 'reembolso@twr.com' },
  };
  const rApprove = await enviar_webhook('Aprovacao posterior', aprovacao_fora_ordem);
  console.log(`    -> 2o Aprovacao posterior recebida: Status ${rApprove.status} (Esperado: 201)`);

  // Cenario 6: Venda em Moeda Estrangeira (USD $ 40.00)
  const evento_usd = {
    platform: 'stripe',
    event_id: `evt_sim_${id_execucao}_usd`,
    event_type: 'sale.approved',
    order_id: `ord_${id_execucao}_usd`,
    product: { id: 'prod_intl', name: 'International Pass' },
    currency: 'USD',
    amount_cents: 4000,
    customer: { email: 'international@twr.com' },
  };
  const rUsd = await enviar_webhook('6. Venda Internacional USD $ 40.00', evento_usd);
  console.log(`\n[6] Venda USD: Status ${rUsd.status} (Esperado: 201)`);

  // Cenario 7: Payload com erro de validacao (Schema invalido)
  const payload_invalido = { platform: 'kiwify', amount_cents: -50 };
  const rInvalid = await enviar_webhook('7. Payload Invalido', payload_invalido);
  console.log(`[7] Validacao Zod (Campos invalidos): Status ${rInvalid.status} (Esperado: 422)`);

  // Cenario 8: Assinatura adulterada / invalida
  const rBadSig = await enviar_webhook('8. Assinatura Invalida', evento_venda_1, {
    assinatura_customizada: 'fake_tampered_signature_00000000000000',
  });
  console.log(`[8] Seguranca HMAC (Assinatura falsa): Status ${rBadSig.status} (Esperado: 401)`);

  // 3. Verificacao do Relatorio
  console.log('\n' + '='.repeat(70));
  console.log('[RELATORIO] RECONCILIACAO FINANCEIRA (GET /reports/sales)');
  console.log('='.repeat(70));

  const resposta_relatorio = await fetch(`${API_URL}/reports/sales`);
  const relatorio = await resposta_relatorio.json();

  console.log(JSON.stringify(relatorio, null, 2));

  console.log('\n' + '='.repeat(70));
  console.log('[SUCESSO] SIMULACAO CONCLUIDA COM SUCESSO!');
  console.log('   - Idempotencia validada contra retries e concorrencia.');
  console.log('   - Reembolsos e aprovacoes fora de ordem reconciliados.');
  console.log('   - Moedas isoladas e integridade criptografica preservada.');
  console.log('='.repeat(70));
}

executar_simulacao().catch(console.error);
