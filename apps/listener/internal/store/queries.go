package store

import (
	"context"
	"time"
)

// TransferRow is the API/dashboard projection of a stored transfer.
type TransferRow struct {
	ChainID     uint64    `json:"chain_id"`
	TxHash      string    `json:"tx_hash"`
	LogIndex    int64     `json:"log_index"`
	BlockNumber int64     `json:"block_number"`
	SeenAt      time.Time `json:"seen_at"`
	Token       string    `json:"token"`
	TokenSymbol string    `json:"token_symbol"`
	From        string    `json:"from"`
	To          string    `json:"to"`
	FromLabel   string    `json:"from_label"`
	ToLabel     string    `json:"to_label"`
	Amount      float64   `json:"amount"`
	PriceUSD    float64   `json:"price_usd"`
	AmountUSD   float64   `json:"amount_usd"`
	Direction   string    `json:"direction"`
}

// TransferFilter narrows a transfer listing.
type TransferFilter struct {
	ChainID   uint64
	Token     string
	Wallet    string
	Direction string
	MinUSD    float64
	Since     time.Duration
	Limit     int
}

// ListTransfers returns whale transfers newest first.
func (p *Postgres) ListTransfers(ctx context.Context, f TransferFilter) ([]TransferRow, error) {
	if f.Limit <= 0 || f.Limit > 500 {
		f.Limit = 100
	}
	if f.Since <= 0 {
		f.Since = 7 * 24 * time.Hour
	}
	rows, err := p.pool.Query(ctx, `
		SELECT chain_id, tx_hash, log_index, block_number, seen_at, token, token_symbol,
		       from_address, to_address, from_label, to_label, amount, price_usd, amount_usd, direction
		FROM transfers
		WHERE seen_at >= now() - make_interval(secs => $1)
		  AND ($2 = 0 OR chain_id = $2)
		  AND ($3 = '' OR lower(token) = lower($3))
		  AND ($4 = '' OR lower(from_address) = lower($4) OR lower(to_address) = lower($4))
		  AND ($5 = '' OR direction = $5)
		  AND amount_usd >= $6
		ORDER BY seen_at DESC
		LIMIT $7`,
		f.Since.Seconds(), int64(f.ChainID), f.Token, f.Wallet, f.Direction, f.MinUSD, f.Limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []TransferRow{}
	for rows.Next() {
		var t TransferRow
		var chainID int64
		if err := rows.Scan(&chainID, &t.TxHash, &t.LogIndex, &t.BlockNumber, &t.SeenAt, &t.Token,
			&t.TokenSymbol, &t.From, &t.To, &t.FromLabel, &t.ToLabel, &t.Amount, &t.PriceUSD,
			&t.AmountUSD, &t.Direction); err != nil {
			return nil, err
		}
		t.ChainID = uint64(chainID)
		out = append(out, t)
	}
	return out, rows.Err()
}

// ScoreRow is the API projection of a token score.
type ScoreRow struct {
	ChainID       uint64    `json:"chain_id"`
	Token         string    `json:"token"`
	Symbol        string    `json:"symbol"`
	Score         float64   `json:"score"`
	PreviousScore float64   `json:"previous_score"`
	DexBuyUSD     float64   `json:"dex_buy_usd"`
	DexSellUSD    float64   `json:"dex_sell_usd"`
	CEXInflowUSD  float64   `json:"cex_inflow_usd"`
	CEXOutflowUSD float64   `json:"cex_outflow_usd"`
	NetAccumUSD   float64   `json:"net_accum_usd"`
	UniqueBuyers  int       `json:"unique_buyers"`
	WhaleTxCount  int       `json:"whale_tx_count"`
	ComputedAt    time.Time `json:"computed_at"`
}

// ListScores returns the highest scoring tokens, optionally per chain.
func (p *Postgres) ListScores(ctx context.Context, chainID uint64, limit int) ([]ScoreRow, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := p.pool.Query(ctx, `
		SELECT chain_id, token, symbol, score, previous_score, dex_buy_usd, dex_sell_usd,
		       cex_inflow_usd, cex_outflow_usd, net_accum_usd, unique_buyers, whale_tx_count, computed_at
		FROM token_scores
		WHERE ($1 = 0 OR chain_id = $1)
		ORDER BY score DESC, net_accum_usd DESC
		LIMIT $2`, int64(chainID), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []ScoreRow{}
	for rows.Next() {
		var s ScoreRow
		var cid int64
		if err := rows.Scan(&cid, &s.Token, &s.Symbol, &s.Score, &s.PreviousScore, &s.DexBuyUSD,
			&s.DexSellUSD, &s.CEXInflowUSD, &s.CEXOutflowUSD, &s.NetAccumUSD, &s.UniqueBuyers,
			&s.WhaleTxCount, &s.ComputedAt); err != nil {
			return nil, err
		}
		s.ChainID = uint64(cid)
		out = append(out, s)
	}
	return out, rows.Err()
}

// Stats is the dashboard headline summary.
type Stats struct {
	Transfers24h    int64   `json:"transfers_24h"`
	Volume24hUSD    float64 `json:"volume_24h_usd"`
	CEXOutflow24h   float64 `json:"cex_outflow_24h_usd"`
	CEXInflow24h    float64 `json:"cex_inflow_24h_usd"`
	NewPools24h     int64   `json:"new_pools_24h"`
	TrackedTokens   int64   `json:"tracked_tokens"`
	LargestTradeUSD float64 `json:"largest_trade_24h_usd"`
}

// Summary aggregates the last 24h across all chains.
func (p *Postgres) Summary(ctx context.Context) (Stats, error) {
	var s Stats
	err := p.pool.QueryRow(ctx, `
		SELECT
			(SELECT count(*) FROM transfers WHERE seen_at >= now() - interval '24 hours'),
			(SELECT COALESCE(SUM(amount_usd),0) FROM transfers WHERE seen_at >= now() - interval '24 hours'),
			(SELECT COALESCE(SUM(amount_usd),0) FROM transfers WHERE seen_at >= now() - interval '24 hours' AND direction = 'cex_withdrawal'),
			(SELECT COALESCE(SUM(amount_usd),0) FROM transfers WHERE seen_at >= now() - interval '24 hours' AND direction = 'cex_deposit'),
			(SELECT count(*) FROM pools WHERE created_at >= now() - interval '24 hours'),
			(SELECT count(*) FROM tokens),
			(SELECT COALESCE(MAX(amount_usd),0) FROM transfers WHERE seen_at >= now() - interval '24 hours')`).
		Scan(&s.Transfers24h, &s.Volume24hUSD, &s.CEXOutflow24h, &s.CEXInflow24h, &s.NewPools24h, &s.TrackedTokens, &s.LargestTradeUSD)
	return s, err
}

// PoolRow is the API projection of a discovered pool.
type PoolRow struct {
	ChainID   uint64    `json:"chain_id"`
	Address   string    `json:"address"`
	Dex       string    `json:"dex"`
	Version   string    `json:"version"`
	Token0    string    `json:"token0"`
	Token1    string    `json:"token1"`
	FeeTier   int64     `json:"fee_tier"`
	CreatedAt time.Time `json:"created_at"`
}

// ListPools returns recently created pools newest first.
func (p *Postgres) ListPools(ctx context.Context, chainID uint64, limit int) ([]PoolRow, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := p.pool.Query(ctx, `
		SELECT chain_id, address, dex, version, token0, token1, fee_tier, created_at
		FROM pools
		WHERE ($1 = 0 OR chain_id = $1)
		ORDER BY created_at DESC
		LIMIT $2`, int64(chainID), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []PoolRow{}
	for rows.Next() {
		var r PoolRow
		var cid int64
		if err := rows.Scan(&cid, &r.Address, &r.Dex, &r.Version, &r.Token0, &r.Token1, &r.FeeTier, &r.CreatedAt); err != nil {
			return nil, err
		}
		r.ChainID = uint64(cid)
		out = append(out, r)
	}
	return out, rows.Err()
}

// UpsertWalletTag lets the admin panel add or edit a label.
func (p *Postgres) UpsertWalletTag(ctx context.Context, chainID uint64, address, label, category string) error {
	_, err := p.pool.Exec(ctx, `
		INSERT INTO wallet_tags (chain_id, address, label, category, updated_at)
		VALUES ($1,$2,$3,$4, now())
		ON CONFLICT (chain_id, address) DO UPDATE
		SET label = EXCLUDED.label, category = EXCLUDED.category, updated_at = now()`,
		int64(chainID), address, label, category)
	return err
}

// DeleteWalletTag removes a label.
func (p *Postgres) DeleteWalletTag(ctx context.Context, chainID uint64, address string) error {
	_, err := p.pool.Exec(ctx, `DELETE FROM wallet_tags WHERE chain_id = $1 AND lower(address) = lower($2)`, int64(chainID), address)
	return err
}

// BotUser is a Telegram subscriber record.
type BotUser struct {
	TelegramID   int64      `json:"telegram_id"`
	Username     string     `json:"username"`
	Tier         string     `json:"tier"`
	VIPExpiresAt *time.Time `json:"vip_expires_at"`
	MinUSD       float64    `json:"min_usd"`
	Muted        bool       `json:"muted"`
	CreatedAt    time.Time  `json:"created_at"`
}

// ListBotUsers powers the admin panel subscriber table.
func (p *Postgres) ListBotUsers(ctx context.Context, limit int) ([]BotUser, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	rows, err := p.pool.Query(ctx, `
		SELECT telegram_id, COALESCE(username,''), tier, vip_expires_at, min_usd, muted, created_at
		FROM bot_users ORDER BY created_at DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []BotUser{}
	for rows.Next() {
		var u BotUser
		if err := rows.Scan(&u.TelegramID, &u.Username, &u.Tier, &u.VIPExpiresAt, &u.MinUSD, &u.Muted, &u.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

// SetUserTier grants or revokes VIP from the admin panel.
func (p *Postgres) SetUserTier(ctx context.Context, telegramID int64, tier string, expires *time.Time) error {
	_, err := p.pool.Exec(ctx, `
		UPDATE bot_users SET tier = $2, vip_expires_at = $3, updated_at = now() WHERE telegram_id = $1`,
		telegramID, tier, expires)
	return err
}

// Prune deletes raw history older than retention so the database stays flat in
// steady state. Alert outcomes, wallet scores and user data are kept: they are
// the track record the product is built on.
func (p *Postgres) Prune(ctx context.Context, retention time.Duration) (int64, error) {
	if retention <= 0 {
		return 0, nil
	}
	secs := retention.Seconds()
	var total int64
	for _, q := range []string{
		`DELETE FROM transfers      WHERE seen_at     < now() - make_interval(secs => $1)`,
		`DELETE FROM score_history  WHERE computed_at < now() - make_interval(secs => $1)`,
		`DELETE FROM delivered_alerts WHERE delivered_at < now() - make_interval(secs => $1)`,
	} {
		tag, err := p.pool.Exec(ctx, q, secs)
		if err != nil {
			return total, err
		}
		total += tag.RowsAffected()
	}
	return total, nil
}
