-- Tabela de log imutavel de eventos de venda (Append-Only)
-- Responsavel pelo armazenamento do fluxo de criar_vendas e processamento de postbacks
CREATE TABLE IF NOT EXISTS sale_events (
    id BIGSERIAL PRIMARY KEY,
    platform VARCHAR(50) NOT NULL,            -- Plataforma de origem (ex: kiwify, hotmart, stripe)
    event_id VARCHAR(128) NOT NULL,           -- ID unico do evento gerado pela plataforma
    event_type VARCHAR(50) NOT NULL,          -- Tipo do evento (approved, refunded, canceled)
    order_id VARCHAR(128) NOT NULL,           -- ID do pedido de compra
    product_id VARCHAR(128) NOT NULL,         -- ID do produto vendido
    product_name VARCHAR(255) NOT NULL,       -- Nome legivel do produto
    currency VARCHAR(3) NOT NULL,             -- Codigo ISO da moeda (BRL, USD, EUR)
    amount_cents BIGINT NOT NULL,             -- Valor monetario em centavos inteiros (sem float)
    customer_email VARCHAR(255) NOT NULL,     -- E-mail do comprador
    customer_name VARCHAR(255),               -- Nome do comprador (opcional)
    payload JSONB NOT NULL,                   -- Payload JSON bruto recebido para auditoria
    event_created_at TIMESTAMPTZ NOT NULL,    -- Timestamp em que o evento ocorreu na plataforma
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- Data/hora de ingestao no receptor
    
    -- Constraint central de idempotencia: impede duplicacao no nivel de banco
    CONSTRAINT uk_platform_event UNIQUE (platform, event_id)
);

-- Indices otimizados para agregacao de relatorios analiticos
CREATE INDEX IF NOT EXISTS idx_sale_events_order_id ON sale_events(order_id);
CREATE INDEX IF NOT EXISTS idx_sale_events_reporting ON sale_events(event_type, currency, event_created_at);
CREATE INDEX IF NOT EXISTS idx_sale_events_product_id ON sale_events(product_id);
CREATE INDEX IF NOT EXISTS idx_sale_events_platform ON sale_events(platform);
