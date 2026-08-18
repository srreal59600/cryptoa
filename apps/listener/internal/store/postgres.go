package store

import (
	"context"
	"fmt"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/whaleradar/listener/internal/model"
)

// Postgres is the persistence layer shared by the listener, scorer and API.
type Postgres struct {
	pool *pgxpool.Pool
}

// NewPostgres opens a pgx pool and verifies connectivity.
func NewPostgres(ctx context.Context, dsn string) (*Postgres, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("parse dsn: %w", err)
	}
	cfg.MaxConns = 16
	cfg.MaxConnLifetime = time.Hour

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("connect postgres: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping postgres: %w", err)
	}
	return &Postgres{pool: pool}, nil
}

// Pool exposes the underlying pgx pool.
func (p *Postgres) Pool() *pgxpool.Pool { return p.pool }

// Close releases all connections.
func (p *Postgres) Close() { p.pool.Close() }

// UpsertToken records a token discovered from the registry or a new pool.
func (p *Postgres) UpsertToken(ctx context.Context, chainID uint64, addr common.Address, symbol string, decimals uint8) error {
	_, err := p.pool.Exec(ctx, `
		INSERT INTO tokens (chain_id, address, symbol, decimals)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (chain_id, address) DO UPDATE
		SET symbol = COALESCE(NULLIF(EXCLUDED.symbol, ''), tokens.symbol),
		    decimals = EXCLUDED.decimals`,
		chainID, addr.Hex(), symbol, int16(decimals))
	return err
}

// InsertPool records a pool discovered from PairCreated / PoolCreated.
func (p *Postgres) InsertPool(ctx context.Context, pr model.PoolRef) error {
	_, err := p.pool.Exec(ctx, `
		INSERT INTO pools (chain_id, address, factory, dex, version, token0, token1, fee_tier, block_number, tx_hash, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		ON CONFLICT (chain_id, address) DO NOTHING`,
		pr.ChainID, pr.Address.Hex(), pr.Factory.Hex(), pr.Dex, pr.Version,
		pr.Token0.Hex(), pr.Token1.Hex(), int64(pr.FeeTier), int64(pr.Block), pr.TxHash.Hex(), pr.CreatedAt)
	return err
}

// LoadPools returns every known pool address for a chain so that restarts keep
// their DEX-pool wallet tags.
func (p *Postgres) LoadPools(ctx context.Context, chainID uint64) ([]model.PoolRef, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT address, factory, dex, version, token0, token1, fee_tier
		FROM pools WHERE chain_id = $1`, chainID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []model.PoolRef
	for rows.Next() {
		var address, factory, dex, version, token0, token1 string
		var fee int64
		if err := rows.Scan(&address, &factory, &dex, &version, &token0, &token1, &fee); err != nil {
			return nil, err
		}
		out = append(out, model.PoolRef{
			ChainID: chainID,
			Address: common.HexToAddress(address),
			Factory: common.HexToAddress(factory),
			Dex:     dex,
			Version: version,
			Token0:  common.HexToAddress(token0),
			Token1:  common.HexToAddress(token1),
			FeeTier: uint32(fee),
		})
	}
	return out, rows.Err()
}

// InsertTransfer persists a priced whale transfer, ignoring duplicates.
func (p *Postgres) InsertTransfer(ctx context.Context, t model.Transfer) error {
	fromLabel, toLabel := "", ""
	if t.FromTag != nil {
		fromLabel = t.FromTag.Label
	}
	if t.ToTag != nil {
		toLabel = t.ToTag.Label
	}
	_, err := p.pool.Exec(ctx, `
		INSERT INTO transfers (
			chain_id, tx_hash, log_index, block_number, seen_at,
			token, token_symbol, from_address, to_address,
			amount, price_usd, amount_usd, direction, from_label, to_label)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
		ON CONFLICT (chain_id, tx_hash, log_index) DO NOTHING`,
		t.ChainID, t.TxHash.Hex(), int64(t.LogIndex), int64(t.BlockNumber), t.SeenAt,
		t.Token.Hex(), t.TokenSymbol, t.From.Hex(), t.To.Hex(),
		t.Amount, t.PriceUSD, t.AmountUSD, string(t.Direction), fromLabel, toLabel)
	return err
}

// LoadWalletTags implements tagging.Store.
func (p *Postgres) LoadWalletTags(ctx context.Context) ([]model.WalletTag, error) {
	rows, err := p.pool.Query(ctx, `SELECT chain_id, address, label, category FROM wallet_tags`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []model.WalletTag
	for rows.Next() {
		var chainID int64
		var address, label, category string
		if err := rows.Scan(&chainID, &address, &label, &category); err != nil {
			return nil, err
		}
		out = append(out, model.WalletTag{
			ChainID:  uint64(chainID),
			Address:  common.HexToAddress(address),
			Label:    label,
			Category: model.WalletCategory(category),
		})
	}
	return out, rows.Err()
}

// UpsertScore stores the latest accumulation snapshot and appends history.
func (p *Postgres) UpsertScore(ctx context.Context, s model.TokenScore) error {
	tx, err := p.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op once committed

	if _, err := tx.Exec(ctx, `
		INSERT INTO token_scores (
			chain_id, token, symbol, score, dex_buy_usd, dex_sell_usd,
			cex_inflow_usd, cex_outflow_usd, unique_buyers, whale_tx_count,
			net_accum_usd, largest_trade_usd, computed_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
		ON CONFLICT (chain_id, token) DO UPDATE SET
			symbol = EXCLUDED.symbol,
			previous_score = token_scores.score,
			score = EXCLUDED.score,
			dex_buy_usd = EXCLUDED.dex_buy_usd,
			dex_sell_usd = EXCLUDED.dex_sell_usd,
			cex_inflow_usd = EXCLUDED.cex_inflow_usd,
			cex_outflow_usd = EXCLUDED.cex_outflow_usd,
			unique_buyers = EXCLUDED.unique_buyers,
			whale_tx_count = EXCLUDED.whale_tx_count,
			net_accum_usd = EXCLUDED.net_accum_usd,
			largest_trade_usd = EXCLUDED.largest_trade_usd,
			computed_at = EXCLUDED.computed_at`,
		s.ChainID, s.Token, s.Symbol, s.Score, s.DexBuyUSD, s.DexSellUSD,
		s.CEXInflowUSD, s.CEXOutflowUSD, s.UniqueBuyers, s.WhaleTxCount,
		s.NetAccumUSD, s.LargestTradeUS, s.ComputedAt); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO score_history (chain_id, token, score, net_accum_usd, computed_at)
		VALUES ($1,$2,$3,$4,$5)`,
		s.ChainID, s.Token, s.Score, s.NetAccumUSD, s.ComputedAt); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ScoreInput is the 24h aggregate used by the scoring formula.
type ScoreInput struct {
	ChainID       uint64
	Token         string
	Symbol        string
	DexBuyUSD     float64
	DexSellUSD    float64
	CEXInflowUSD  float64
	CEXOutflowUSD float64
	UniqueBuyers  int
	WhaleTxCount  int
	LargestTrade  float64
	PreviousScore float64
}

// TokenWindow returns the flow aggregate of a single token over the window,
// used to attach 24h context to an outgoing alert.
func (p *Postgres) TokenWindow(ctx context.Context, chainID uint64, token common.Address, window time.Duration) (ScoreInput, error) {
	in := ScoreInput{ChainID: chainID, Token: token.Hex()}
	err := p.pool.QueryRow(ctx, `
		SELECT
			COALESCE(MAX(token_symbol), ''),
			COALESCE(SUM(amount_usd) FILTER (WHERE direction = 'dex_buy'), 0),
			COALESCE(SUM(amount_usd) FILTER (WHERE direction = 'dex_sell'), 0),
			COALESCE(SUM(amount_usd) FILTER (WHERE direction = 'cex_deposit'), 0),
			COALESCE(SUM(amount_usd) FILTER (WHERE direction = 'cex_withdrawal'), 0),
			COUNT(DISTINCT to_address) FILTER (WHERE direction IN ('dex_buy','cex_withdrawal')),
			COUNT(*),
			COALESCE(MAX(amount_usd), 0)
		FROM transfers
		WHERE chain_id = $1 AND token = $2 AND seen_at >= now() - $3::interval`,
		int64(chainID), in.Token, fmt.Sprintf("%d seconds", int(window.Seconds()))).
		Scan(&in.Symbol, &in.DexBuyUSD, &in.DexSellUSD, &in.CEXInflowUSD, &in.CEXOutflowUSD,
			&in.UniqueBuyers, &in.WhaleTxCount, &in.LargestTrade)
	return in, err
}

// AggregateWindow returns per-token 24h flow aggregates for scoring.
func (p *Postgres) AggregateWindow(ctx context.Context, window time.Duration) ([]ScoreInput, error) {
	rows, err := p.pool.Query(ctx, `
		SELECT
			t.chain_id,
			t.token,
			COALESCE(MAX(t.token_symbol), '') AS symbol,
			COALESCE(SUM(t.amount_usd) FILTER (WHERE t.direction = 'dex_buy'), 0)        AS dex_buy,
			COALESCE(SUM(t.amount_usd) FILTER (WHERE t.direction = 'dex_sell'), 0)       AS dex_sell,
			COALESCE(SUM(t.amount_usd) FILTER (WHERE t.direction = 'cex_deposit'), 0)    AS cex_in,
			COALESCE(SUM(t.amount_usd) FILTER (WHERE t.direction = 'cex_withdrawal'), 0) AS cex_out,
			COUNT(DISTINCT t.to_address) FILTER (WHERE t.direction IN ('dex_buy','cex_withdrawal')) AS unique_buyers,
			COUNT(*) AS whale_txs,
			COALESCE(MAX(t.amount_usd), 0) AS largest,
			COALESCE(MAX(s.score), 0) AS previous_score
		FROM transfers t
		LEFT JOIN token_scores s ON s.chain_id = t.chain_id AND s.token = t.token
		WHERE t.seen_at >= now() - $1::interval
		GROUP BY t.chain_id, t.token`,
		fmt.Sprintf("%d seconds", int(window.Seconds())))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []ScoreInput
	for rows.Next() {
		var in ScoreInput
		var chainID int64
		if err := rows.Scan(&chainID, &in.Token, &in.Symbol, &in.DexBuyUSD, &in.DexSellUSD,
			&in.CEXInflowUSD, &in.CEXOutflowUSD, &in.UniqueBuyers, &in.WhaleTxCount,
			&in.LargestTrade, &in.PreviousScore); err != nil {
			return nil, err
		}
		in.ChainID = uint64(chainID)
		out = append(out, in)
	}
	return out, rows.Err()
}
