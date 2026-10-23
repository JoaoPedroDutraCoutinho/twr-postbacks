-- Tabela de log imutável de eventos de venda (Append-Only)
CREATE TABLE IF NOT EXISTS sale_events (
    id BIGSERIAL PRIMARY KEY,
    platform VARCHAR(50) NOT NULL,
    event_id VARCHAR(128) NOT NULL,
    event_type VARCHAR(50) NOT NULL,
    order_id VARCHAR(128) NOT NULL,
    product_id VARCHAR(128) NOT NULL,
    product_name VARCHAR(255) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    amount_cents BIGINT NOT NULL,
    customer_email VARCHAR(255) NOT NULL,
    customer_name VARCHAR(255),
    payload JSONB NOT NULL,
    event_created_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraint central de idempotência
    CONSTRAINT uk_platform_event UNIQUE (platform, event_id)
);

-- Índices otimizados para agregação de relatórios analíticos
CREATE INDEX IF NOT EXISTS idx_sale_events_order_id ON sale_events(order_id);
CREATE INDEX IF NOT EXISTS idx_sale_events_reporting ON sale_events(event_type, currency, event_created_at);
CREATE INDEX IF NOT EXISTS idx_sale_events_product_id ON sale_events(product_id);
CREATE INDEX IF NOT EXISTS idx_sale_events_platform ON sale_events(platform);
