-- Alert outcome tracking and smart-money wallet scoring.

-- price_at returns the observed price of a token closest to a point in time,
-- taken from the whale transfer stream itself (no external price feed needed).
CREATE OR REPLACE FUNCTION price_at(p_chain BIGINT, p_token TEXT, p_at TIMESTAMPTZ)
RETURNS DOUBLE PRECISION
LANGUAGE sql STABLE AS $$
    SELECT price_usd
    FROM transfers
    WHERE chain_id = p_chain AND token = p_token AND price_usd > 0
      AND seen_at BETWEEN p_at - interval '45 minutes' AND p_at + interval '45 minutes'
    ORDER BY abs(extract(epoch FROM (seen_at - p_at)))
    LIMIT 1
$$;

-- One row per published alert. The price columns are filled in later by the
-- scorer so the platform can prove how its signals actually performed.
CREATE TABLE IF NOT EXISTS alert_outcomes (
    alert_id      TEXT PRIMARY KEY,
    chain_id      BIGINT           NOT NULL,
    token         TEXT             NOT NULL,
    token_symbol  TEXT             NOT NULL DEFAULT '',
    direction     TEXT             NOT NULL,
    tier          TEXT             NOT NULL DEFAULT 'free',
    wallet        TEXT             NOT NULL DEFAULT '',
    amount_usd    DOUBLE PRECISION NOT NULL,
    score         DOUBLE PRECISION NOT NULL DEFAULT 0,
    entry_price   DOUBLE PRECISION NOT NULL,
    price_1h      DOUBLE PRECISION,
    price_4h      DOUBLE PRECISION,
    price_24h     DOUBLE PRECISION,
    ret_1h        DOUBLE PRECISION,
    ret_4h        DOUBLE PRECISION,
    ret_24h       DOUBLE PRECISION,
    created_at    TIMESTAMPTZ      NOT NULL DEFAULT now(),
    settled_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS alert_outcomes_created_idx ON alert_outcomes (created_at DESC);
CREATE INDEX IF NOT EXISTS alert_outcomes_open_idx    ON alert_outcomes (settled_at) WHERE settled_at IS NULL;

-- Forward-return track record of individual wallets: the base of "smart money".
CREATE TABLE IF NOT EXISTS wallet_scores (
    chain_id    BIGINT           NOT NULL,
    address     TEXT             NOT NULL,
    trades      INTEGER          NOT NULL DEFAULT 0,
    wins        INTEGER          NOT NULL DEFAULT 0,
    avg_ret_24h DOUBLE PRECISION NOT NULL DEFAULT 0,
    best_ret    DOUBLE PRECISION NOT NULL DEFAULT 0,
    volume_usd  DOUBLE PRECISION NOT NULL DEFAULT 0,
    score       DOUBLE PRECISION NOT NULL DEFAULT 50,
    updated_at  TIMESTAMPTZ      NOT NULL DEFAULT now(),
    PRIMARY KEY (chain_id, address)
);
CREATE INDEX IF NOT EXISTS wallet_scores_score_idx ON wallet_scores (score DESC);
