-- WhaleRadar core schema.
CREATE TABLE IF NOT EXISTS tokens (
    chain_id    BIGINT      NOT NULL,
    address     TEXT        NOT NULL,
    symbol      TEXT        NOT NULL DEFAULT '',
    decimals    SMALLINT    NOT NULL DEFAULT 18,
    first_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, address)
);

CREATE TABLE IF NOT EXISTS pools (
    chain_id     BIGINT      NOT NULL,
    address      TEXT        NOT NULL,
    factory      TEXT        NOT NULL,
    dex          TEXT        NOT NULL,
    version      TEXT        NOT NULL,
    token0       TEXT        NOT NULL,
    token1       TEXT        NOT NULL,
    fee_tier     BIGINT      NOT NULL DEFAULT 0,
    block_number BIGINT      NOT NULL DEFAULT 0,
    tx_hash      TEXT        NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, address)
);
CREATE INDEX IF NOT EXISTS pools_created_at_idx ON pools (created_at DESC);

CREATE TABLE IF NOT EXISTS transfers (
    id            BIGSERIAL PRIMARY KEY,
    chain_id      BIGINT           NOT NULL,
    tx_hash       TEXT             NOT NULL,
    log_index     BIGINT           NOT NULL,
    block_number  BIGINT           NOT NULL,
    seen_at       TIMESTAMPTZ      NOT NULL DEFAULT now(),
    token         TEXT             NOT NULL,
    token_symbol  TEXT             NOT NULL DEFAULT '',
    from_address  TEXT             NOT NULL,
    to_address    TEXT             NOT NULL,
    from_label    TEXT             NOT NULL DEFAULT '',
    to_label      TEXT             NOT NULL DEFAULT '',
    amount        DOUBLE PRECISION NOT NULL,
    price_usd     DOUBLE PRECISION NOT NULL,
    amount_usd    DOUBLE PRECISION NOT NULL,
    direction     TEXT             NOT NULL,
    UNIQUE (chain_id, tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS transfers_seen_at_idx    ON transfers (seen_at DESC);
CREATE INDEX IF NOT EXISTS transfers_token_idx      ON transfers (chain_id, token, seen_at DESC);
CREATE INDEX IF NOT EXISTS transfers_amount_usd_idx ON transfers (amount_usd DESC);
CREATE INDEX IF NOT EXISTS transfers_from_idx       ON transfers (from_address);
CREATE INDEX IF NOT EXISTS transfers_to_idx         ON transfers (to_address);

CREATE TABLE IF NOT EXISTS wallet_tags (
    chain_id   BIGINT      NOT NULL,
    address    TEXT        NOT NULL,
    label      TEXT        NOT NULL,
    category   TEXT        NOT NULL DEFAULT 'unknown',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, address)
);

CREATE TABLE IF NOT EXISTS token_scores (
    chain_id          BIGINT           NOT NULL,
    token             TEXT             NOT NULL,
    symbol            TEXT             NOT NULL DEFAULT '',
    score             DOUBLE PRECISION NOT NULL DEFAULT 50,
    previous_score    DOUBLE PRECISION NOT NULL DEFAULT 50,
    dex_buy_usd       DOUBLE PRECISION NOT NULL DEFAULT 0,
    dex_sell_usd      DOUBLE PRECISION NOT NULL DEFAULT 0,
    cex_inflow_usd    DOUBLE PRECISION NOT NULL DEFAULT 0,
    cex_outflow_usd   DOUBLE PRECISION NOT NULL DEFAULT 0,
    unique_buyers     INTEGER          NOT NULL DEFAULT 0,
    whale_tx_count    INTEGER          NOT NULL DEFAULT 0,
    net_accum_usd     DOUBLE PRECISION NOT NULL DEFAULT 0,
    largest_trade_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
    computed_at       TIMESTAMPTZ      NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, token)
);
CREATE INDEX IF NOT EXISTS token_scores_score_idx ON token_scores (score DESC);

CREATE TABLE IF NOT EXISTS score_history (
    id            BIGSERIAL PRIMARY KEY,
    chain_id      BIGINT           NOT NULL,
    token         TEXT             NOT NULL,
    score         DOUBLE PRECISION NOT NULL,
    net_accum_usd DOUBLE PRECISION NOT NULL,
    computed_at   TIMESTAMPTZ      NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS score_history_token_idx ON score_history (chain_id, token, computed_at DESC);

-- Telegram subscribers. `tier` is free | vip.
CREATE TABLE IF NOT EXISTS bot_users (
    telegram_id    BIGINT PRIMARY KEY,
    username       TEXT,
    first_name     TEXT,
    tier           TEXT             NOT NULL DEFAULT 'free',
    vip_expires_at TIMESTAMPTZ,
    min_usd        DOUBLE PRECISION NOT NULL DEFAULT 100000,
    chains         BIGINT[]         NOT NULL DEFAULT '{}',
    muted          BOOLEAN          NOT NULL DEFAULT false,
    created_at     TIMESTAMPTZ      NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ      NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS watchlist (
    id          BIGSERIAL PRIMARY KEY,
    telegram_id BIGINT      NOT NULL REFERENCES bot_users (telegram_id) ON DELETE CASCADE,
    chain_id    BIGINT      NOT NULL,
    kind        TEXT        NOT NULL, -- token | wallet
    address     TEXT        NOT NULL,
    label       TEXT        NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (telegram_id, chain_id, kind, address)
);

CREATE TABLE IF NOT EXISTS payments (
    id          BIGSERIAL PRIMARY KEY,
    telegram_id BIGINT           NOT NULL,
    plan        TEXT             NOT NULL,
    amount_usd  DOUBLE PRECISION NOT NULL,
    chain_id    BIGINT,
    tx_hash     TEXT,
    status      TEXT             NOT NULL DEFAULT 'pending', -- pending | confirmed | rejected
    created_at  TIMESTAMPTZ      NOT NULL DEFAULT now(),
    confirmed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS delivered_alerts (
    id          BIGSERIAL PRIMARY KEY,
    alert_id    TEXT        NOT NULL,
    telegram_id BIGINT      NOT NULL,
    delivered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (alert_id, telegram_id)
);
