package pipeline

import (
	"context"
	"log/slog"
	"math/big"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/whaleradar/listener/internal/config"
	"github.com/whaleradar/listener/internal/eth"
	"github.com/whaleradar/listener/internal/model"
	"github.com/whaleradar/listener/internal/pricing"
	"github.com/whaleradar/listener/internal/scoring"
	"github.com/whaleradar/listener/internal/store"
	"github.com/whaleradar/listener/internal/tagging"
)

// Runner owns the full listen -> decode -> price -> filter -> persist -> alert
// pipeline for a single chain.
type Runner struct {
	cfg    config.Config
	chain  config.Chain
	logger *slog.Logger

	caller  *eth.Caller
	pricer  *pricing.Engine
	tagger  *tagging.Tagger
	pg      *store.Postgres
	rdb     *redis.Client
	subTx   *eth.Subscriber
	subPool *eth.Subscriber

	mu       sync.RWMutex
	tracked  map[common.Address]struct{}
	trackedL []common.Address
}

// NewRunner wires a chain runner. wsURL/httpURL must both be configured.
func NewRunner(ctx context.Context, cfg config.Config, chain config.Chain, wsURL, httpURL string,
	pg *store.Postgres, rdb *redis.Client, tagger *tagging.Tagger, logger *slog.Logger) (*Runner, error) {

	caller, err := eth.NewCaller(ctx, httpURL)
	if err != nil {
		return nil, err
	}

	r := &Runner{
		cfg:     cfg,
		chain:   chain,
		logger:  logger.With("chain", chain.Slug, "chain_id", chain.ChainID),
		caller:  caller,
		pricer:  pricing.New(chain, caller, rdb),
		tagger:  tagger,
		pg:      pg,
		rdb:     rdb,
		tracked: map[common.Address]struct{}{},
	}

	for _, t := range chain.Tokens {
		r.track(t.Address)
		if err := pg.UpsertToken(ctx, chain.ChainID, t.Address, t.Symbol, t.Decimals); err != nil {
			r.logger.Warn("upsert registry token failed", "token", t.Symbol, "err", err)
		}
	}

	// Re-tag pools discovered in previous runs and keep tracking their tokens.
	pools, err := pg.LoadPools(ctx, chain.ChainID)
	if err != nil {
		r.logger.Warn("loading known pools failed", "err", err)
	}
	for _, p := range pools {
		tagger.PutPool(chain.ChainID, p.Address, p.Dex)
		r.track(p.Token0)
		r.track(p.Token1)
	}

	logs := make(chan types.Log, 4096)
	r.subTx = eth.NewSubscriber(chain.Slug+"/transfers", wsURL, caller, r.logger, logs, r.transferQuery)
	r.subPool = eth.NewSubscriber(chain.Slug+"/pools", wsURL, caller, r.logger, logs, r.poolQuery)
	go r.consume(ctx, logs)

	return r, nil
}

// Run starts both subscriptions and blocks until ctx is cancelled.
func (r *Runner) Run(ctx context.Context) {
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); r.subTx.Run(ctx) }()
	go func() { defer wg.Done(); r.subPool.Run(ctx) }()
	wg.Wait()
	r.caller.Close()
}

func (r *Runner) transferQuery() ethereum.FilterQuery {
	r.mu.RLock()
	addrs := make([]common.Address, len(r.trackedL))
	copy(addrs, r.trackedL)
	r.mu.RUnlock()
	return eth.Query(addrs, []common.Hash{eth.TopicTransfer})
}

func (r *Runner) poolQuery() ethereum.FilterQuery {
	addrs := make([]common.Address, 0, len(r.chain.Factories))
	for _, f := range r.chain.Factories {
		addrs = append(addrs, f.Address)
	}
	return eth.Query(addrs, []common.Hash{eth.TopicPairCreated, eth.TopicPoolCreated})
}

func (r *Runner) track(a common.Address) bool {
	if a == (common.Address{}) {
		return false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.tracked[a]; ok {
		return false
	}
	r.tracked[a] = struct{}{}
	r.trackedL = append(r.trackedL, a)
	return true
}

func (r *Runner) consume(ctx context.Context, logs <-chan types.Log) {
	for {
		select {
		case <-ctx.Done():
			return
		case l := <-logs:
			if len(l.Topics) == 0 {
				continue
			}
			var err error
			switch l.Topics[0] {
			case eth.TopicTransfer:
				err = r.handleTransfer(ctx, l)
			case eth.TopicPairCreated:
				err = r.handlePairCreated(ctx, l)
			case eth.TopicPoolCreated:
				err = r.handlePoolCreated(ctx, l)
			}
			if err != nil {
				r.logger.Debug("log handling failed", "tx", l.TxHash.Hex(), "topic", l.Topics[0].Hex(), "err", err)
			}
		}
	}
}

func (r *Runner) handleTransfer(ctx context.Context, l types.Log) error {
	if l.Removed || len(l.Topics) < 3 {
		return nil
	}
	from := common.BytesToAddress(l.Topics[1].Bytes())
	to := common.BytesToAddress(l.Topics[2].Bytes())
	raw := new(big.Int).SetBytes(l.Data)
	if raw.Sign() == 0 {
		return nil
	}

	amount, price, usd, err := r.pricer.AmountUSD(ctx, l.Address, raw)
	if err != nil {
		return err
	}
	// Hard floor: everything below MIN_USD is discarded before persistence.
	if usd < r.cfg.MinUSD {
		return nil
	}

	decimals, _ := r.pricer.Decimals(ctx, l.Address)
	symbol, err := r.caller.Symbol(ctx, l.Address)
	if err != nil {
		symbol = tagging.Short(l.Address)
	}
	direction, fromTag, toTag := r.tagger.Classify(r.chain.ChainID, from, to)

	t := model.Transfer{
		ChainID:       r.chain.ChainID,
		ChainSlug:     r.chain.Slug,
		TxHash:        l.TxHash,
		LogIndex:      l.Index,
		BlockNumber:   l.BlockNumber,
		SeenAt:        time.Now().UTC(),
		Token:         l.Address,
		TokenSymbol:   symbol,
		TokenDecimals: decimals,
		From:          from,
		To:            to,
		Raw:           raw,
		Amount:        amount,
		PriceUSD:      price,
		AmountUSD:     usd,
		FromTag:       fromTag,
		ToTag:         toTag,
		Direction:     direction,
	}
	if err := r.pg.InsertTransfer(ctx, t); err != nil {
		return err
	}
	r.logger.Info("whale transfer",
		"symbol", symbol, "usd", usd, "direction", direction, "tx", l.TxHash.Hex())

	if usd >= r.cfg.AlertUSD {
		return r.publishTransferAlert(ctx, t)
	}
	return nil
}

func (r *Runner) publishTransferAlert(ctx context.Context, t model.Transfer) error {
	tier := "vip"
	if t.AmountUSD >= r.cfg.FreeChannelUSD {
		tier = "free"
	}
	a := model.Alert{
		ID:          uuid.NewString(),
		Kind:        "whale_transfer",
		Tier:        tier,
		ChainID:     t.ChainID,
		Chain:       r.chain.Name,
		Explorer:    r.chain.Explorer,
		TxHash:      t.TxHash.Hex(),
		Token:       t.Token.Hex(),
		TokenSymbol: t.TokenSymbol,
		From:        t.From.Hex(),
		To:          t.To.Hex(),
		FromLabel:   tagging.LabelOr(t.FromTag, t.From),
		ToLabel:     tagging.LabelOr(t.ToTag, t.To),
		Direction:   string(t.Direction),
		Amount:      t.Amount,
		AmountUSD:   t.AmountUSD,
		PriceUSD:    t.PriceUSD,
		Note:        directionNote(t.Direction),
		CreatedAt:   time.Now().UTC(),
	}
	return store.PublishAlert(ctx, r.rdb, a)
}

func directionNote(d model.Direction) string {
	switch d {
	case model.DirCEXWithdrawal:
		return "Exchange outflow — supply leaving CEX custody"
	case model.DirCEXDeposit:
		return "Exchange inflow — possible sell pressure"
	case model.DirDexBuy:
		return "DEX buy — liquidity pool paying out tokens"
	case model.DirDexSell:
		return "DEX sell — tokens pushed into a pool"
	case model.DirMint:
		return "Token mint"
	case model.DirBurn:
		return "Token burn"
	default:
		return "Wallet-to-wallet transfer"
	}
}

func (r *Runner) handlePairCreated(ctx context.Context, l types.Log) error {
	if len(l.Topics) < 3 || len(l.Data) < 64 {
		return nil
	}
	token0 := common.BytesToAddress(l.Topics[1].Bytes())
	token1 := common.BytesToAddress(l.Topics[2].Bytes())
	pair := common.BytesToAddress(l.Data[12:32])
	return r.registerPool(ctx, l, token0, token1, pair, 0, string(config.DexV2))
}

func (r *Runner) handlePoolCreated(ctx context.Context, l types.Log) error {
	if len(l.Topics) < 4 || len(l.Data) < 64 {
		return nil
	}
	token0 := common.BytesToAddress(l.Topics[1].Bytes())
	token1 := common.BytesToAddress(l.Topics[2].Bytes())
	fee := new(big.Int).SetBytes(l.Topics[3].Bytes()).Uint64()
	pool := common.BytesToAddress(l.Data[44:64])
	return r.registerPool(ctx, l, token0, token1, pool, uint32(fee), string(config.DexV3))
}

func (r *Runner) registerPool(ctx context.Context, l types.Log, token0, token1, pool common.Address, fee uint32, version string) error {
	dex := "DEX"
	if f, ok := r.chain.FactoryIndex()[l.Address]; ok {
		dex = f.Name
	}
	ref := model.PoolRef{
		ChainID:   r.chain.ChainID,
		Address:   pool,
		Factory:   l.Address,
		Dex:       dex,
		Version:   version,
		Token0:    token0,
		Token1:    token1,
		FeeTier:   fee,
		CreatedAt: time.Now().UTC(),
		Block:     l.BlockNumber,
		TxHash:    l.TxHash,
	}
	if err := r.pg.InsertPool(ctx, ref); err != nil {
		return err
	}
	r.tagger.PutPool(r.chain.ChainID, pool, dex)

	// Newly listed tokens become tracked so their transfers are picked up.
	changed := false
	for _, tok := range []common.Address{token0, token1} {
		if r.track(tok) {
			changed = true
			symbol, err := r.caller.Symbol(ctx, tok)
			if err != nil {
				symbol = ""
			}
			decimals, err := r.pricer.Decimals(ctx, tok)
			if err != nil {
				decimals = 18
			}
			if err := r.pg.UpsertToken(ctx, r.chain.ChainID, tok, symbol, decimals); err != nil {
				r.logger.Warn("upsert discovered token failed", "token", tok.Hex(), "err", err)
			}
		}
	}
	r.logger.Info("new pool", "dex", dex, "version", version, "pool", pool.Hex(), "fee", fee)
	if changed {
		r.subTx.Restart()
	}
	return nil
}

// PublishScoreAlert emits an accumulation alert (used by the scorer binary).
func PublishScoreAlert(ctx context.Context, rdb *redis.Client, chain config.Chain, s model.TokenScore) error {
	return store.PublishAlert(ctx, rdb, model.Alert{
		ID:          uuid.NewString(),
		Kind:        "accumulation",
		Tier:        "vip",
		ChainID:     s.ChainID,
		Chain:       chain.Name,
		Explorer:    chain.Explorer,
		Token:       s.Token,
		TokenSymbol: s.Symbol,
		Score:       s.Score,
		AmountUSD:   s.NetAccumUSD,
		Note:        scoring.Label(s.Score),
		CreatedAt:   time.Now().UTC(),
	})
}
