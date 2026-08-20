package store

import (
	"context"
	"time"
)

// WhaleAccount is a wallet large enough to be followed as an entity, together
// with the measured result of what it bought over the lookback window.
type WhaleAccount struct {
	ChainID    uint64     `json:"chain_id"`
	Address    string     `json:"address"`
	Label      string     `json:"label"`
	VolumeUSD  float64    `json:"volume_usd"`
	InflowUSD  float64    `json:"inflow_usd"`
	OutflowUSD float64    `json:"outflow_usd"`
	TxCount    int        `json:"tx_count"`
	Tokens     int        `json:"tokens"`
	PnLUSD     float64    `json:"pnl_usd"`
	PnLPct     float64    `json:"pnl_pct"`
	LastSeen   *time.Time `json:"last_seen"`
}

// RefreshWhaleAccounts rebuilds the whale account table from the transfer
// history: every untagged wallet that moved at least minUSD over the window.
// Exchange hot wallets and pools are excluded — they are infrastructure, not
// traders, and following them says nothing about intent.
func (p *Postgres) RefreshWhaleAccounts(ctx context.Context, window time.Duration, minUSD float64) (int64, error) {
	tag, err := p.pool.Exec(ctx, `
		WITH legs AS (
			SELECT chain_id, lower(to_address)   AS address, token, amount_usd,          0::float8 AS out_usd, amount_usd AS in_usd, seen_at
			FROM transfers WHERE seen_at >= now() - make_interval(secs => $1)
			UNION ALL
			SELECT chain_id, lower(from_address) AS address, token, amount_usd, amount_usd AS out_usd, 0::float8 AS in_usd, seen_at
			FROM transfers WHERE seen_at >= now() - make_interval(secs => $1)
		), agg AS (
			SELECT l.chain_id, l.address,
			       SUM(l.amount_usd)          AS volume_usd,
			       SUM(l.in_usd)              AS inflow_usd,
			       SUM(l.out_usd)             AS outflow_usd,
			       count(*)                   AS tx_count,
			       count(DISTINCT l.token)    AS tokens,
			       MAX(l.seen_at)             AS last_seen
			FROM legs l
			LEFT JOIN wallet_tags g ON g.chain_id = l.chain_id AND lower(g.address) = l.address
			WHERE g.address IS NULL
			  AND l.address <> '0x0000000000000000000000000000000000000000'
			GROUP BY l.chain_id, l.address
			HAVING SUM(l.amount_usd) >= $2
		)
		INSERT INTO whale_accounts (chain_id, address, volume_usd, inflow_usd, outflow_usd,
		                            tx_count, tokens, last_seen, updated_at)
		SELECT chain_id, address, volume_usd, inflow_usd, outflow_usd, tx_count, tokens, last_seen, now()
		FROM agg
		ON CONFLICT (chain_id, address) DO UPDATE SET
			volume_usd = EXCLUDED.volume_usd, inflow_usd = EXCLUDED.inflow_usd,
			outflow_usd = EXCLUDED.outflow_usd, tx_count = EXCLUDED.tx_count,
			tokens = EXCLUDED.tokens, last_seen = EXCLUDED.last_seen, updated_at = now()`,
		window.Seconds(), minUSD)
	if err != nil {
		return 0, err
	}
	// Accounts that dropped out of the window stop being whales.
	if _, err := p.pool.Exec(ctx,
		`DELETE FROM whale_accounts WHERE updated_at < now() - interval '2 hours'`); err != nil {
		return tag.RowsAffected(), err
	}
	return tag.RowsAffected(), nil
}

// RefreshWhalePnL marks each whale account to market: every accumulation leg
// is valued at the token's latest observed price, so the number answers "would
// this wallet be up if it still held what it bought in the window?".
func (p *Postgres) RefreshWhalePnL(ctx context.Context, window time.Duration) error {
	_, err := p.pool.Exec(ctx, `
		WITH latest AS (
			SELECT DISTINCT ON (chain_id, token) chain_id, token, price_usd
			FROM transfers
			WHERE price_usd > 0 AND seen_at >= now() - interval '48 hours'
			ORDER BY chain_id, token, seen_at DESC
		), buys AS (
			SELECT t.chain_id, lower(t.to_address) AS address, t.token,
			       SUM(t.amount_usd)                       AS cost_usd,
			       SUM(t.amount * l.price_usd)             AS value_usd
			FROM transfers t
			JOIN latest l ON l.chain_id = t.chain_id AND l.token = t.token
			WHERE t.direction IN ('dex_buy','cex_withdrawal')
			  AND t.price_usd > 0
			  AND t.seen_at >= now() - make_interval(secs => $1)
			GROUP BY t.chain_id, lower(t.to_address), t.token
		), pnl AS (
			SELECT chain_id, address, SUM(cost_usd) AS cost_usd, SUM(value_usd) AS value_usd
			FROM buys GROUP BY chain_id, address
		)
		UPDATE whale_accounts w SET
			cost_usd = p.cost_usd,
			pnl_usd = p.value_usd - p.cost_usd,
			pnl_pct = CASE WHEN p.cost_usd > 0 THEN p.value_usd / p.cost_usd - 1 ELSE 0 END,
			updated_at = now()
		FROM pnl p
		WHERE w.chain_id = p.chain_id AND w.address = p.address`, window.Seconds())
	return err
}

// ListWhaleAccounts returns the biggest tracked accounts, newest data first.
func (p *Postgres) ListWhaleAccounts(ctx context.Context, chainID uint64, limit int) ([]WhaleAccount, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := p.pool.Query(ctx, `
		SELECT w.chain_id, w.address, COALESCE(g.label,''), w.volume_usd, w.inflow_usd, w.outflow_usd,
		       w.tx_count, w.tokens, w.pnl_usd, w.pnl_pct, w.last_seen
		FROM whale_accounts w
		LEFT JOIN wallet_tags g ON g.chain_id = w.chain_id AND lower(g.address) = w.address
		WHERE ($1 = 0 OR w.chain_id = $1)
		ORDER BY w.volume_usd DESC
		LIMIT $2`, int64(chainID), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []WhaleAccount{}
	for rows.Next() {
		var w WhaleAccount
		var cid int64
		if err := rows.Scan(&cid, &w.Address, &w.Label, &w.VolumeUSD, &w.InflowUSD, &w.OutflowUSD,
			&w.TxCount, &w.Tokens, &w.PnLUSD, &w.PnLPct, &w.LastSeen); err != nil {
			return nil, err
		}
		w.ChainID = uint64(cid)
		out = append(out, w)
	}
	return out, rows.Err()
}

// IsWhaleAccount reports whether an address is on the tracked whale list.
func (p *Postgres) IsWhaleAccount(ctx context.Context, chainID uint64, address string) (bool, error) {
	var ok bool
	err := p.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM whale_accounts WHERE chain_id = $1 AND address = lower($2))`,
		int64(chainID), address).Scan(&ok)
	return ok, err
}

// TokenVolume returns the traded USD volume observed for a token in the window.
// It is the denominator of the liquidity-impact ratio: a transfer worth a large
// share of it can move the price hard.
func (p *Postgres) TokenVolume(ctx context.Context, chainID uint64, token string, window time.Duration) (float64, error) {
	var v float64
	err := p.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_usd), 0) FROM transfers
		WHERE chain_id = $1 AND lower(token) = lower($2)
		  AND seen_at >= now() - make_interval(secs => $3)`,
		int64(chainID), token, window.Seconds()).Scan(&v)
	return v, err
}

// RoundTripUSD measures how much value flowed back from `to` to `from` on the
// same token inside the window. Value cycling between two addresses is the
// signature of wash trading: volume is created without any real position change.
func (p *Postgres) RoundTripUSD(ctx context.Context, chainID uint64, token, from, to string,
	window time.Duration) (float64, error) {

	var v float64
	err := p.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_usd), 0) FROM transfers
		WHERE chain_id = $1 AND lower(token) = lower($2)
		  AND lower(from_address) = lower($3) AND lower(to_address) = lower($4)
		  AND seen_at >= now() - make_interval(secs => $5)`,
		int64(chainID), token, to, from, window.Seconds()).Scan(&v)
	return v, err
}

// WatchItem is one wallet or token a VIP follows, with their own nickname.
type WatchItem struct {
	ChainID   uint64    `json:"chain_id"`
	Kind      string    `json:"kind"`
	Address   string    `json:"address"`
	Label     string    `json:"label"`
	CreatedAt time.Time `json:"created_at"`
}

// ListWatchlist returns everything a user follows.
func (p *Postgres) ListWatchlist(ctx context.Context, telegramID int64) ([]WatchItem, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT chain_id, kind, address, COALESCE(label,''), created_at
		FROM watchlist WHERE telegram_id = $1 ORDER BY created_at`, telegramID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []WatchItem{}
	for rows.Next() {
		var w WatchItem
		var cid int64
		if err := rows.Scan(&cid, &w.Kind, &w.Address, &w.Label, &w.CreatedAt); err != nil {
			return nil, err
		}
		w.ChainID = uint64(cid)
		out = append(out, w)
	}
	return out, rows.Err()
}

// AddWatch follows an address, storing (or updating) the user's nickname for it.
func (p *Postgres) AddWatch(ctx context.Context, telegramID int64, chainID uint64, kind, address, label string) error {
	_, err := p.pool.Exec(ctx, `
		INSERT INTO watchlist (telegram_id, chain_id, kind, address, label)
		VALUES ($1,$2,$3,lower($4),$5)
		ON CONFLICT (telegram_id, chain_id, kind, address) DO UPDATE SET label = EXCLUDED.label`,
		telegramID, int64(chainID), kind, address, label)
	return err
}

// RemoveWatch unfollows an address.
func (p *Postgres) RemoveWatch(ctx context.Context, telegramID int64, address string) (int64, error) {
	tag, err := p.pool.Exec(ctx,
		`DELETE FROM watchlist WHERE telegram_id = $1 AND address = lower($2)`, telegramID, address)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// WalletPnL is the 30-day mark-to-market result of one wallet.
type WalletPnL struct {
	ChainID   uint64  `json:"chain_id"`
	Address   string  `json:"address"`
	CostUSD   float64 `json:"cost_usd"`
	ValueUSD  float64 `json:"value_usd"`
	PnLUSD    float64 `json:"pnl_usd"`
	PnLPct    float64 `json:"pnl_pct"`
	Buys      int     `json:"buys"`
	Tokens    int     `json:"tokens"`
	BestToken string  `json:"best_token"`
	BestPct   float64 `json:"best_pct"`
}

// WalletPnLWindow values everything a wallet accumulated in the window at the
// latest observed price. Positions sold before now are not netted out, so the
// figure is an estimate of the wallet's entries, not audited accounting.
func (p *Postgres) WalletPnLWindow(ctx context.Context, chainID uint64, address string,
	window time.Duration) (WalletPnL, error) {

	out := WalletPnL{ChainID: chainID, Address: address}
	rows, err := p.pool.Query(ctx, `
		WITH latest AS (
			SELECT DISTINCT ON (chain_id, token) chain_id, token, price_usd
			FROM transfers
			WHERE price_usd > 0 AND seen_at >= now() - interval '48 hours'
			ORDER BY chain_id, token, seen_at DESC
		)
		SELECT COALESCE(NULLIF(t.token_symbol,''), t.token) AS symbol,
		       SUM(t.amount_usd)             AS cost_usd,
		       SUM(t.amount * l.price_usd)   AS value_usd,
		       count(*)                      AS buys
		FROM transfers t
		JOIN latest l ON l.chain_id = t.chain_id AND l.token = t.token
		WHERE ($1 = 0 OR t.chain_id = $1)
		  AND lower(t.to_address) = lower($2)
		  AND t.direction IN ('dex_buy','cex_withdrawal')
		  AND t.price_usd > 0
		  AND t.seen_at >= now() - make_interval(secs => $3)
		GROUP BY 1`, int64(chainID), address, window.Seconds())
	if err != nil {
		return out, err
	}
	defer rows.Close()

	for rows.Next() {
		var symbol string
		var cost, value float64
		var buys int
		if err := rows.Scan(&symbol, &cost, &value, &buys); err != nil {
			return out, err
		}
		out.CostUSD += cost
		out.ValueUSD += value
		out.Buys += buys
		out.Tokens++
		if cost > 0 {
			if pct := value/cost - 1; out.BestToken == "" || pct > out.BestPct {
				out.BestToken, out.BestPct = symbol, pct
			}
		}
	}
	if err := rows.Err(); err != nil {
		return out, err
	}
	out.PnLUSD = out.ValueUSD - out.CostUSD
	if out.CostUSD > 0 {
		out.PnLPct = out.ValueUSD/out.CostUSD - 1
	}
	return out, nil
}
