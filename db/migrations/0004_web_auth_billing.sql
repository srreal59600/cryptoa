-- Web sign-in sessions and USDT subscription billing.

-- Telegram Login Widget sessions for the dashboard.
CREATE TABLE IF NOT EXISTS web_sessions (
    token       TEXT PRIMARY KEY,
    telegram_id BIGINT      NOT NULL REFERENCES bot_users (telegram_id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS web_sessions_user_idx ON web_sessions (telegram_id);
CREATE INDEX IF NOT EXISTS web_sessions_expiry_idx ON web_sessions (expires_at);

-- Invoices are matched on-chain by a unique cent amount sent to the receiving address.
CREATE TABLE IF NOT EXISTS invoices (
    id           BIGSERIAL PRIMARY KEY,
    telegram_id  BIGINT           NOT NULL REFERENCES bot_users (telegram_id) ON DELETE CASCADE,
    plan         TEXT             NOT NULL DEFAULT 'vip_monthly',
    days         INTEGER          NOT NULL DEFAULT 30,
    amount_usdt  NUMERIC(18, 6)   NOT NULL,
    network      TEXT             NOT NULL,
    pay_to       TEXT             NOT NULL,
    status       TEXT             NOT NULL DEFAULT 'pending', -- pending | paid | expired | cancelled
    tx_hash      TEXT,
    created_at   TIMESTAMPTZ      NOT NULL DEFAULT now(),
    expires_at   TIMESTAMPTZ      NOT NULL,
    paid_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS invoices_status_idx ON invoices (status, expires_at);
CREATE INDEX IF NOT EXISTS invoices_user_idx ON invoices (telegram_id, created_at DESC);
-- Only one live invoice may claim a given cent amount, which is what makes matching unambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS invoices_pending_amount_idx
    ON invoices (network, pay_to, amount_usdt)
    WHERE status = 'pending';
