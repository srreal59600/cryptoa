package store

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// RecordAlertOutcome opens the performance record of a published alert. The
// forward prices are filled in later by the scorer.
func (p *Postgres) RecordAlertOutcome(ctx context.Context, o AlertOutcome) error {
	_, err := p.pool.Exec(ctx, `
		INSERT INTO alert_outcomes (
			alert_id, chain_id, token, token_symbol, direction, tier, wallet,
			amount_usd, score, entry_price, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		ON CONFLICT (alert_id) DO NOTHING`,
		o.AlertID, int64(o.ChainID), o.Token, o.TokenSymbol, o.Direction, o.Tier, o.Wallet,
		o.AmountUSD, o.Score, o.EntryPrice, o.CreatedAt)
	return err
}

// AlertOutcome is one tracked signal and, once settled, how it performed.
type AlertOutcome struct {
	AlertID     string     `json:"alert_id"`
	ChainID     uint64     `json:"chain_id"`
	Token       string     `json:"token"`
	TokenSymbol string     `json:"token_symbol"`
	Direction   string     `json:"direction"`
	Tier        string     `json:"tier"`
	Wallet      string     `json:"wallet"`
	AmountUSD   float64    `json:"amount_usd"`
	Score       float64    `json:"score"`
	EntryPrice  float64    `json:"entry_price"`
	Ret1h       *float64   `json:"ret_1h"`
	Ret4h       *float64   `json:"ret_4h"`
	Ret24h      *float64   `json:"ret_24h"`
	CreatedAt   time.Time  `json:"created_at"`
	SettledAt   *time.Time `json:"settled_at"`
}

// SettleOutcomes fills in the 1h/4h/24h forward returns of open alerts using
// the observed transfer price stream, and closes rows older than 25h.
// It returns how many rows were touched.
func (p *Postgres) SettleOutcomes(ctx context.Context) (int64, error) {
	tag, err := p.pool.Exec(ctx, `
		UPDATE alert_outcomes o SET
			price_1h  = COALESCE(o.price_1h,  price_at(o.chain_id, o.token, o.created_at + interval '1 hour')),
			price_4h  = COALESCE(o.price_4h,  price_at(o.chain_id, o.token, o.created_at + interval '4 hours')),
			price_24h = COALESCE(o.price_24h, price_at(o.chain_id, o.token, o.created_at + interval '24 hours'))
		WHERE o.settled_at IS NULL AND o.created_at <= now() - interval '1 hour'`)
	if err != nil {
		return 0, err
	}
	if _, err := p.pool.Exec(ctx, `
		UPDATE alert_outcomes SET
			ret_1h  = CASE WHEN price_1h  IS NOT NULL AND entry_price > 0 THEN price_1h  / entry_price - 1 END,
			ret_4h  = CASE WHEN price_4h  IS NOT NULL AND entry_price > 0 THEN price_4h  / entry_price - 1 END,
			ret_24h = CASE WHEN price_24h IS NOT NULL AND entry_price > 0 THEN price_24h / entry_price - 1 END,
			settled_at = CASE WHEN created_at <= now() - interval '25 hours' THEN now() END
		WHERE settled_at IS NULL AND created_at <= now() - interval '1 hour'`); err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// PerformanceHorizon is the aggregate track record over one holding period.
type PerformanceHorizon struct {
	Horizon   string  `json:"horizon"`
	Samples   int     `json:"samples"`
	WinRate   float64 `json:"win_rate"`
	AvgReturn float64 `json:"avg_return"`
	BestRet   float64 `json:"best_return"`
	WorstRet  float64 `json:"worst_return"`
}

// Performance summarises how alerts of the last `days` days played out.
func (p *Postgres) Performance(ctx context.Context, days int, direction string) ([]PerformanceHorizon, error) {
	if days <= 0 || days > 365 {
		days = 30
	}
	out := make([]PerformanceHorizon, 0, 3)
	for _, h := range []struct {
		name string
		col  string
	}{{"1h", "ret_1h"}, {"4h", "ret_4h"}, {"24h", "ret_24h"}} {
		row := PerformanceHorizon{Horizon: h.name}
		// #nosec G201 -- h.col comes from the fixed list above, never user input.
		err := p.pool.QueryRow(ctx, `
			SELECT count(`+h.col+`),
			       COALESCE(AVG((`+h.col+` > 0)::int::float8), 0),
			       COALESCE(AVG(`+h.col+`), 0),
			       COALESCE(MAX(`+h.col+`), 0),
			       COALESCE(MIN(`+h.col+`), 0)
			FROM alert_outcomes
			WHERE created_at >= now() - make_interval(days => $1)
			  AND ($2 = '' OR direction = $2)`, days, direction).
			Scan(&row.Samples, &row.WinRate, &row.AvgReturn, &row.BestRet, &row.WorstRet)
		if err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, nil
}

// ListOutcomes returns recent tracked alerts newest first.
func (p *Postgres) ListOutcomes(ctx context.Context, limit int) ([]AlertOutcome, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := p.pool.Query(ctx, `
		SELECT alert_id, chain_id, token, token_symbol, direction, tier, wallet,
		       amount_usd, score, entry_price, ret_1h, ret_4h, ret_24h, created_at, settled_at
		FROM alert_outcomes ORDER BY created_at DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []AlertOutcome{}
	for rows.Next() {
		var o AlertOutcome
		var cid int64
		if err := rows.Scan(&o.AlertID, &cid, &o.Token, &o.TokenSymbol, &o.Direction, &o.Tier,
			&o.Wallet, &o.AmountUSD, &o.Score, &o.EntryPrice, &o.Ret1h, &o.Ret4h, &o.Ret24h,
			&o.CreatedAt, &o.SettledAt); err != nil {
			return nil, err
		}
		o.ChainID = uint64(cid)
		out = append(out, o)
	}
	return out, rows.Err()
}

// WalletPerf is a wallet's realised forward-return track record.
type WalletPerf struct {
	ChainID   uint64  `json:"chain_id"`
	Address   string  `json:"address"`
	Trades    int     `json:"trades"`
	Wins      int     `json:"wins"`
	AvgRet24h float64 `json:"avg_ret_24h"`
	BestRet   float64 `json:"best_ret"`
	VolumeUSD float64 `json:"volume_usd"`
	Score     float64 `json:"score"`
}

// WalletPerformance measures, per receiving wallet, how the tokens it bought
// (DEX buys and exchange withdrawals) moved over the following 24 hours.
func (p *Postgres) WalletPerformance(ctx context.Context, lookback time.Duration, minUSD float64) ([]WalletPerf, error) {
	rows, err := p.pool.Query(ctx, `
		WITH buys AS (
			SELECT t.chain_id, t.to_address AS wallet, t.token, t.price_usd, t.amount_usd, t.seen_at
			FROM transfers t
			LEFT JOIN wallet_tags g ON g.chain_id = t.chain_id AND lower(g.address) = lower(t.to_address)
			WHERE t.direction IN ('dex_buy','cex_withdrawal')
			  AND t.price_usd > 0
			  AND t.amount_usd >= $2
			  AND t.seen_at BETWEEN now() - make_interval(secs => $1) AND now() - interval '24 hours'
			  AND g.address IS NULL
		)
		SELECT b.chain_id, b.wallet, count(*), count(*) FILTER (WHERE f.price_usd > b.price_usd),
		       AVG(f.price_usd / b.price_usd - 1), MAX(f.price_usd / b.price_usd - 1), SUM(b.amount_usd)
		FROM buys b
		JOIN LATERAL (
			SELECT t.price_usd FROM transfers t
			WHERE t.chain_id = b.chain_id AND t.token = b.token AND t.price_usd > 0
			  AND t.seen_at BETWEEN b.seen_at + interval '23 hours' AND b.seen_at + interval '26 hours'
			ORDER BY t.seen_at LIMIT 1
		) f ON true
		GROUP BY b.chain_id, b.wallet
		HAVING count(*) >= 2`, lookback.Seconds(), minUSD)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []WalletPerf{}
	for rows.Next() {
		var w WalletPerf
		var cid int64
		if err := rows.Scan(&cid, &w.Address, &w.Trades, &w.Wins, &w.AvgRet24h, &w.BestRet, &w.VolumeUSD); err != nil {
			return nil, err
		}
		w.ChainID = uint64(cid)
		out = append(out, w)
	}
	return out, rows.Err()
}

// UpsertWalletScore stores a computed smart-money score.
func (p *Postgres) UpsertWalletScore(ctx context.Context, w WalletPerf) error {
	_, err := p.pool.Exec(ctx, `
		INSERT INTO wallet_scores (chain_id, address, trades, wins, avg_ret_24h, best_ret, volume_usd, score, updated_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
		ON CONFLICT (chain_id, address) DO UPDATE SET
			trades = EXCLUDED.trades, wins = EXCLUDED.wins, avg_ret_24h = EXCLUDED.avg_ret_24h,
			best_ret = EXCLUDED.best_ret, volume_usd = EXCLUDED.volume_usd, score = EXCLUDED.score,
			updated_at = now()`,
		int64(w.ChainID), w.Address, w.Trades, w.Wins, w.AvgRet24h, w.BestRet, w.VolumeUSD, w.Score)
	return err
}

// WalletScore returns the smart-money score of one wallet, 0 when unknown.
func (p *Postgres) WalletScore(ctx context.Context, chainID uint64, address string) (WalletPerf, bool, error) {
	var w WalletPerf
	var cid int64
	err := p.pool.QueryRow(ctx, `
		SELECT chain_id, address, trades, wins, avg_ret_24h, best_ret, volume_usd, score
		FROM wallet_scores WHERE chain_id = $1 AND lower(address) = lower($2)`,
		int64(chainID), address).
		Scan(&cid, &w.Address, &w.Trades, &w.Wins, &w.AvgRet24h, &w.BestRet, &w.VolumeUSD, &w.Score)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return w, false, nil
		}
		return w, false, err
	}
	w.ChainID = uint64(cid)
	return w, true, nil
}

// SmartWalletsOnToken counts how many wallets with a proven track record
// accumulated this token inside the window — the "smart money cluster" signal.
func (p *Postgres) SmartWalletsOnToken(ctx context.Context, chainID uint64, token string,
	window time.Duration, minScore float64) (int, error) {

	var n int
	err := p.pool.QueryRow(ctx, `
		SELECT count(DISTINCT t.to_address)
		FROM transfers t
		JOIN wallet_scores w ON w.chain_id = t.chain_id AND lower(w.address) = lower(t.to_address)
		WHERE t.chain_id = $1 AND t.token = $2
		  AND t.direction IN ('dex_buy','cex_withdrawal')
		  AND t.seen_at >= now() - make_interval(secs => $3)
		  AND w.score >= $4`, int64(chainID), token, window.Seconds(), minScore).Scan(&n)
	return n, err
}

// ListSmartWallets powers the dashboard smart-money leaderboard.
func (p *Postgres) ListSmartWallets(ctx context.Context, limit int) ([]WalletPerf, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := p.pool.Query(ctx, `
		SELECT chain_id, address, trades, wins, avg_ret_24h, best_ret, volume_usd, score
		FROM wallet_scores ORDER BY score DESC, trades DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []WalletPerf{}
	for rows.Next() {
		var w WalletPerf
		var cid int64
		if err := rows.Scan(&cid, &w.Address, &w.Trades, &w.Wins, &w.AvgRet24h, &w.BestRet, &w.VolumeUSD, &w.Score); err != nil {
			return nil, err
		}
		w.ChainID = uint64(cid)
		out = append(out, w)
	}
	return out, rows.Err()
}
