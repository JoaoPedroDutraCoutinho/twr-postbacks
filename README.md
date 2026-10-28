# TWR Postbacks: Receptor de Webhooks de Vendas

API em **TypeScript + Fastify + PostgreSQL** que recebe webhooks de vendas de plataformas de checkout (Kiwify, Hotmart, Stripe) com **idempotência**, **assinatura HMAC-SHA256** e **tolerância a eventos fora de ordem**, e gera um **relatório de vendas consolidado por moeda**.

## Em produção

**Base URL:** https://twr-postbacks-v8wu.onrender.com

Hospedado no Render (plano gratuito): a primeira requisição depois de um tempo parado pode levar até 1 minuto.

| Rota | Descrição |
| :--- | :--- |
| `POST /webhooks/sales` | Recebe o evento de venda (exige o header `X-Signature`) |
| `GET /reports/sales` | Relatório por moeda. Filtros opcionais: `from`, `to`, `group_by=day\|product\|platform` |
| `GET /health` | Status do serviço e do banco |
| `GET /metrics` | Métricas no formato Prometheus |

Respostas do webhook: `201` evento novo · `200` duplicado (ignorado) · `401` assinatura inválida · `422` payload inválido · `429` limite de requisições · `500` falha interna (a plataforma deve reenviar).

O segredo do webhook em produção é o mesmo do ambiente local: `twr_webhook_secret_key_2026`.

## Rodando localmente

Requisitos: Node.js 22+ e Docker.

```bash
git clone https://github.com/JoaoPedroDutraCoutinho/twr-postbacks.git
cd twr-postbacks
npm install
cp .env.example .env
docker compose up -d   # PostgreSQL + Jaeger
npm run dev            # as migrações rodam sozinhas na inicialização
```

Sem Docker: defina `USE_MEMORY_DB=true` no `.env` para usar um banco em memória.

## Testes

```bash
npm test           # 9 testes automatizados
npm run simulate   # simula uma plataforma de checkout contra o servidor rodando
```

Os testes cobrem evento duplicado, 20 envios simultâneos, reembolso antes da aprovação, payload inválido, assinatura adulterada, isolamento de moedas, health, agrupamento e métricas. Eles usam um banco em memória para rodar em menos de 1 segundo. A concorrência no PostgreSQL real é comprovada pelo simulador (10 envios simultâneos do mesmo evento resultam em 1× `201` e 9× `200`).

Para rodar o simulador contra a produção: `API_URL=https://twr-postbacks-v8wu.onrender.com npm run simulate`.

A pasta `postman/` tem uma coleção com testes e cálculo automático da assinatura, com ambientes local e de produção.

## Exemplo

A assinatura é o HMAC-SHA256 dos **bytes exatos** do corpo. Gerando:

```bash
node -e "const c=require('crypto'); console.log(c.createHmac('sha256','twr_webhook_secret_key_2026').update('{\"platform\":\"kiwify\",\"event_id\":\"evt_demo_101\",\"event_type\":\"sale.approved\",\"order_id\":\"ord_101\",\"product\":{\"id\":\"p1\",\"name\":\"Curso TWR\"},\"currency\":\"BRL\",\"amount_cents\":19700,\"customer\":{\"email\":\"aluno@twr.com\"}}').digest('hex'))"
```

Enviando (o corpo precisa ser idêntico ao usado na assinatura):

```bash
curl -X POST http://localhost:3000/webhooks/sales \
  -H "Content-Type: application/json" \
  -H "X-Signature: 071f23778394ffa336de319d03d23585c6d47afb8c672c41c1481a72430c0d31" \
  -d '{"platform":"kiwify","event_id":"evt_demo_101","event_type":"sale.approved","order_id":"ord_101","product":{"id":"p1","name":"Curso TWR"},"currency":"BRL","amount_cents":19700,"customer":{"email":"aluno@twr.com"}}'
```

Consultando o relatório:

```bash
curl "http://localhost:3000/reports/sales?group_by=product"
```

```json
{
  "period": { "from": "2026-09-28T12:00:00.000Z", "to": "2026-10-28T12:00:00.000Z", "timezone": "UTC" },
  "group_by": "product",
  "currencies": [
    { "currency": "BRL", "gross_cents": 19700, "refunded_cents": 0, "net_cents": 19700, "sales_count": 1, "refunds_count": 0 }
  ],
  "groups": [
    { "group_key": "p1", "group_name": "Curso TWR", "currency": "BRL", "gross_cents": 19700, "refunded_cents": 0, "net_cents": 19700, "sales_count": 1, "refunds_count": 0 }
  ]
}
```

## Decisões de engenharia

- **Idempotência no banco:** `UNIQUE (platform, event_id)` + `INSERT ... ON CONFLICT DO NOTHING`. Uma checagem feita no código sofreria race condition com envios simultâneos.
- **HMAC sobre o corpo bruto:** verificado sobre os bytes originais (antes de ler o JSON), com `timingSafeEqual`, e sempre antes de qualquer outra validação.
- **Log de eventos append-only:** nenhum evento é alterado. O relatório soma aprovações e subtrai reembolsos, então a ordem de chegada não muda o resultado.
- **Dinheiro em centavos inteiros**, **moedas nunca misturadas** e **dias agrupados em UTC**.
- **Validação com Zod** do payload, dos filtros do relatório e das variáveis de ambiente.
- **Rate limit por rota** (200/min no webhook, 60/min no relatório), usando o IP real do cliente atrás do proxy.

## Observabilidade

- **`GET /metrics`:** webhooks por resultado (`created`, `duplicate`, `unauthorized`, `invalid`...), latência por rota e conexões do banco.
- **OpenTelemetry (opcional):** com `OTEL_EXPORTER_OTLP_ENDPOINT` definida, cada requisição gera um trace com os spans do PostgreSQL, e o `trace_id` vai para os logs e para o header `x-trace-id`. Localmente: rode `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 npm run dev` e abra o Jaeger em `http://localhost:16686`.

## O que ficou de fora

- **Fila (Kafka/SQS):** no escopo do desafio, o PostgreSQL com `ON CONFLICT` já garante a idempotência. Com mais volume, o webhook gravaria o payload bruto e responderia na hora, e workers processariam os eventos (`SELECT ... FOR UPDATE SKIP LOCKED`).
- **ClickHouse:** índices no PostgreSQL atendem o volume esperado. Com centenas de milhões de eventos, a tabela de eventos seria replicada para ele.
- **GraphQL:** o enunciado pede `POST` e `GET`, e webhooks são REST por natureza.
- **Próximos passos:** rodar os testes contra PostgreSQL real no CI e permitir a troca do segredo sem downtime.

## Transparência sobre Ferramentas

Conforme as melhores práticas da engenharia moderna este projeto foi planejado arquiteturalmente e implementado com o auxílio de inteligência artificial (Google Antigravity), tendo **cada linha de código, teste automatizado, tipagem e decisão de engenharia minuciosamente revisada, validada e compreendida**.
