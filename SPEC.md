# Spec: Receptor de Postbacks

## 1. Visão Geral
Aplicação em TypeScript/Node.js para recepção de webhooks de plataformas de checkout (vendas digitais) e geração de relatórios consolidados de vendas.

Projetada com base nas realidades de ambientes de produção: retentativas de envio (retries), eventos concorrentes, eventos fora de ordem, garantia de idempotência e validação de autenticidade criptográfica.

---

## 2. Stack Tecnológica
- **Linguagem & Runtime:** Node.js (v22+) & TypeScript (Strict Mode)
- **Framework HTTP:** Fastify (alta performance, suporte nativo a schemas e raw body)
- **Validação de Dados:** Zod
- **Banco de Dados:** PostgreSQL (`pg` driver nativo com connection pooling)
- **Testes Automatizados:** Vitest (testes de integração e unitários rápidos)
- **Containers:** Docker & Docker Compose

---

## 3. Rotas da API

### `POST /webhooks/sales`
Recebe notificações de eventos de venda enviados pelas plataformas de checkout.
- **Headers obrigatórios:**
  - `Content-Type: application/json`
  - `X-Signature: <hex_hmac_sha256>` (HMAC-SHA256 calculado sobre o **corpo bruto/raw body** usando o `WEBHOOK_SECRET`)
- **Respostas:**
  - `201 Created`: Evento inédito recebido, validado e gravado com sucesso.
  - `200 OK`: Evento duplicado recebido (idempotente). Retornado para sinalizar sucesso à plataforma e interromper retentativas sem duplicar dados.
  - `401 Unauthorized`: Assinatura HMAC ausente ou inválida.
  - `422 Unprocessable Entity`: Payload JSON malformado ou violando o schema Zod.
  - `500 Internal Server Error`: Falha inesperada de infraestrutura (banco indisponível). Sinaliza à plataforma que deve retentar o envio.

### `GET /reports/sales`
Retorna métricas analíticas e consolidadas das vendas.
- **Query Params (opcionais):**
  - `from`: Data/hora inicial (ISO 8601, ex: `2026-10-01T00:00:00Z`). Padrão: 30 dias atrás.
  - `to`: Data/hora final (ISO 8601, ex: `2026-10-31T23:59:59Z`). Padrão: momento atual.
  - `group_by`: Dimensão de agrupamento (`day`, `product`, `platform`).
- **Campos do Relatório (separados por moeda):**
  - `currency`: Código da moeda (ex: `BRL`, `USD`). Moedas nunca se misturam.
  - `gross_cents`: Faturamento bruto acumulado de vendas aprovadas (em centavos).
  - `refunded_cents`: Montante total estornado/reembolsado (em centavos).
  - `net_cents`: Faturamento líquido (`gross_cents - refunded_cents`).
  - `sales_count`: Quantidade de vendas aprovadas.
  - `refunds_count`: Quantidade de reembolsos processados.

### `GET /health`
Verificação de saúde do serviço e conectividade com o banco de dados PostgreSQL.
- **Respostas:** `200 OK` (saudável) ou `503 Service Unavailable` (banco fora do ar).

### `GET /metrics`
Métricas no formato Prometheus: webhooks recebidos por resultado (`created`, `duplicate`, `unauthorized`, `invalid`, `rate_limited`, `error`), latência por rota e estado do pool do PostgreSQL.

---

## 4. Regras de Negócio e Engenharia

1. **Idempotência Rigorosa:**
   - Chave composta única: `(platform, event_id)` com constraint `UNIQUE` na tabela `sale_events`.
   - Inserção via `INSERT ... ON CONFLICT (platform, event_id) DO NOTHING RETURNING id`.
   - Se retornar `id`: evento novo -> HTTP `201`.
   - Se não retornar `id`: evento já existia -> HTTP `200` imediato.

2. **Eventos Append-Only:**
   - A tabela `sale_events` é um log imutável de eventos. Cada status (`approved`, `refunded`, `pending`, `canceled`) é registrado como um evento com seu timestamp.
   - O relatório consolida as vendas por meio de agregações SQL (`SUM`, `COUNT`) sobre os eventos válidos.
   - Isso garante tolerância a eventos fora de ordem (ex: se um webhook de reembolso for processado, ele entra como estorno no cálculo do faturamento líquido de forma determinística).

3. **Valores Monetários em Centavos (Inteiros):**
   - Todos os valores são armazenados e trafegados como inteiros (`cents`).
   - Evita problemas de arredondamento de ponto flutuante IEEE 754 (ex: `0.1 + 0.2 !== 0.3`).

4. **Isolamento por Moeda:**
   - Cada venda possui sua moeda (`BRL`, `USD`, `EUR`). Os totais financeiros nunca misturam moedas diferentes; os relatórios agrupam os totais por moeda.

5. **Assinatura HMAC sobre o Raw Body:**
   - O HMAC-SHA256 deve ser calculado sobre o buffer bruto da requisição HTTP (antes do parser JSON do Fastify formatar ou alterar espaçamentos/escapes).

---

## 5. O que Decidimos NÃO Fazer (e Por Quê)

- **Fila Distribuída (Kafka / RabbitMQ / SQS):**
  - *Decisão:* Ingestão direta e síncrona no PostgreSQL com transação e `ON CONFLICT DO NOTHING`.
  - *Motivo:* Para a escala de um receptor de checkout único e o tempo de desenvolvimento de 3-4 horas, introduzir brokers de mensageria adicionaria complexidade operacional desnecessária (falhas de conexão, ack duplo, partições, dead-letters externas). O Postgres suporta milhares de transações por segundo com ACID e sem pontos únicos de falha adicionais.

- **Banco Analítico Dedicado (ClickHouse):**
  - *Decisão:* Agregações SQL analíticas diretamente no PostgreSQL utilizando índices btree em `(event_type, currency, event_created_at)`.
  - *Motivo:* Para volumes de dezenas de milhões de eventos, índices bem estruturados no Postgres respondem agregações em poucos milissegundos. Adotar ClickHouse nesta etapa traria sincronização de CDC (Change Data Capture) desnecessária para o escopo.

- **GraphQL:**
  - *Decisão:* Foco estrito em REST padronizado e robusto conforme solicitado no enunciado principal do desafio (`POST` e `GET`).
  - *Motivo:* REST oferece caching HTTP nativo, menor latência de parsing e perfeita compatibilidade com o ecossistema de webhooks da web.

---

## 6. Fluxo de Trabalho (Metodologia)
- Uma etapa por vez.
- Sempre criar branch semântica (`chore/`, `feat/`, `test/`).
- Commits claros e explicativos.
- Bateria de testes automatizados executando antes de cada merge.
