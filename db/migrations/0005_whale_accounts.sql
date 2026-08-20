-- Whale accounts: wallets whose tracked volume over the rolling window makes
-- them worth following as an entity, plus their measured 30d P&L.
CREATE TABLE IF NOT EXISTS whale_accounts (
    chain_id      BIGINT           NOT NULL,
    address       TEXT             NOT NULL,
    volume_usd    DOUBLE PRECISION NOT NULL DEFAULT 0,
    inflow_usd    DOUBLE PRECISION NOT NULL DEFAULT 0,
    outflow_usd   DOUBLE PRECISION NOT NULL DEFAULT 0,
    tx_count      INTEGER          NOT NULL DEFAULT 0,
    tokens        INTEGER          NOT NULL DEFAULT 0,
    pnl_usd       DOUBLE PRECISION NOT NULL DEFAULT 0,
    pnl_pct       DOUBLE PRECISION NOT NULL DEFAULT 0,
    -- Cost of the entries the P&L is measured against; the P&L itself is
    -- mark to market, not realised accounting.
    cost_usd      DOUBLE PRECISION NOT NULL DEFAULT 0,
    last_seen     TIMESTAMPTZ,
    updated_at    TIMESTAMPTZ      NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, address)
);

CREATE INDEX IF NOT EXISTS whale_accounts_volume_idx ON whale_accounts (volume_usd DESC);

-- Nicknames are per user, so the same address can be "Binance whale" for one
-- VIP and "my copy target" for another.
ALTER TABLE watchlist ADD COLUMN IF NOT EXISTS notify_all BOOLEAN NOT NULL DEFAULT true;
