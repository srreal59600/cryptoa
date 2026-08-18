package pricing

import (
	"context"
	"errors"
	"fmt"
	"math"
	"math/big"
	"strconv"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/redis/go-redis/v9"

	"github.com/whaleradar/listener/internal/config"
	"github.com/whaleradar/listener/internal/eth"
)

// ErrNoRoute is returned when no pool with sufficient liquidity prices a token.
var ErrNoRoute = errors.New("pricing: no liquid pool found for token")

const (
	cacheTTL = 60 * time.Second
	// minQuoteLiquidityUSD guards against pricing off dust / manipulated pools.
	minQuoteLiquidityUSD = 25_000
)

// Engine converts raw token amounts into USD using live on-chain pool state.
type Engine struct {
	chain  config.Chain
	caller *eth.Caller
	rdb    *redis.Client

	tokens map[common.Address]config.Token

	mu       sync.RWMutex
	local    map[common.Address]cached
	decimals map[common.Address]uint8
}

type cached struct {
	price float64
	at    time.Time
}

// New builds a price engine for one chain.
func New(chain config.Chain, caller *eth.Caller, rdb *redis.Client) *Engine {
	e := &Engine{
		chain:    chain,
		caller:   caller,
		rdb:      rdb,
		tokens:   chain.TokenIndex(),
		local:    map[common.Address]cached{},
		decimals: map[common.Address]uint8{},
	}
	for _, t := range chain.Tokens {
		e.decimals[t.Address] = t.Decimals
	}
	return e
}

// Decimals resolves a token's decimals from the registry, falling back to an
// on-chain `decimals()` call for tokens discovered at runtime.
func (e *Engine) Decimals(ctx context.Context, token common.Address) (uint8, error) {
	e.mu.RLock()
	d, ok := e.decimals[token]
	e.mu.RUnlock()
	if ok {
		return d, nil
	}
	d, err := e.caller.Decimals(ctx, token)
	if err != nil {
		return 0, err
	}
	e.mu.Lock()
	e.decimals[token] = d
	e.mu.Unlock()
	return d, nil
}

// Amount converts a raw uint256 value into a decimal-adjusted float.
func Amount(raw *big.Int, decimals uint8) float64 {
	if raw == nil {
		return 0
	}
	f := new(big.Float).SetInt(raw)
	f.Quo(f, pow10(decimals))
	out, _ := f.Float64()
	return out
}

// AmountUSD prices a raw transfer value in USD.
func (e *Engine) AmountUSD(ctx context.Context, token common.Address, raw *big.Int) (amount float64, price float64, usd float64, err error) {
	decimals, err := e.Decimals(ctx, token)
	if err != nil {
		return 0, 0, 0, err
	}
	amount = Amount(raw, decimals)
	price, err = e.PriceUSD(ctx, token)
	if err != nil {
		return amount, 0, 0, err
	}
	return amount, price, amount * price, nil
}

// PriceUSD resolves the USD price of a token, using (in order): the stable
// registry, the in-process cache, Redis, then live pool reserves.
func (e *Engine) PriceUSD(ctx context.Context, token common.Address) (float64, error) {
	if t, ok := e.tokens[token]; ok && t.Stable {
		return 1, nil
	}
	if p, ok := e.fromLocal(token); ok {
		return p, nil
	}
	if p, ok := e.fromRedis(ctx, token); ok {
		e.putLocal(token, p)
		return p, nil
	}

	price, err := e.resolve(ctx, token)
	if err != nil {
		return 0, err
	}
	e.putLocal(token, price)
	e.putRedis(ctx, token, price)
	return price, nil
}

// resolve prices a token against stables first, then against the wrapped
// native asset (multiplying by the native USD price).
func (e *Engine) resolve(ctx context.Context, token common.Address) (float64, error) {
	best, bestLiq := 0.0, 0.0
	for _, stable := range e.chain.Stables() {
		if stable.Address == token {
			return 1, nil
		}
		p, liq, err := e.bestPoolPrice(ctx, token, stable.Address, 1)
		if err == nil && liq > bestLiq {
			best, bestLiq = p, liq
		}
	}
	if bestLiq >= minQuoteLiquidityUSD {
		return best, nil
	}

	native, ok := e.chain.NativeToken()
	if !ok || native.Address == token {
		if bestLiq > 0 {
			return best, nil
		}
		return 0, ErrNoRoute
	}
	nativeUSD, err := e.PriceUSD(ctx, native.Address)
	if err != nil {
		if bestLiq > 0 {
			return best, nil
		}
		return 0, err
	}
	p, liq, err := e.bestPoolPrice(ctx, token, native.Address, nativeUSD)
	if err == nil && liq > bestLiq {
		return p, nil
	}
	if bestLiq > 0 {
		return best, nil
	}
	return 0, ErrNoRoute
}

// bestPoolPrice scans every registered factory for the deepest pool quoting
// `token` in `quote`, returning the USD price and the pool's USD liquidity.
func (e *Engine) bestPoolPrice(ctx context.Context, token, quote common.Address, quoteUSD float64) (float64, float64, error) {
	bestPrice, bestLiquidity := 0.0, 0.0
	for _, f := range e.chain.Factories {
		switch f.Version {
		case config.DexV2:
			pair, err := e.caller.GetPairV2(ctx, f.Address, token, quote)
			if err != nil || pair == (common.Address{}) {
				continue
			}
			price, liq, err := e.v2Price(ctx, pair, token, quote, quoteUSD)
			if err == nil && liq > bestLiquidity {
				bestPrice, bestLiquidity = price, liq
			}
		case config.DexV3:
			for _, fee := range eth.V3FeeTiers {
				pool, err := e.caller.GetPoolV3(ctx, f.Address, token, quote, fee)
				if err != nil || pool == (common.Address{}) {
					continue
				}
				price, liq, err := e.v3Price(ctx, pool, token, quote, quoteUSD)
				if err == nil && liq > bestLiquidity {
					bestPrice, bestLiquidity = price, liq
				}
			}
		}
	}
	if bestLiquidity == 0 {
		return 0, 0, ErrNoRoute
	}
	return bestPrice, bestLiquidity, nil
}

func (e *Engine) v2Price(ctx context.Context, pair, token, quote common.Address, quoteUSD float64) (float64, float64, error) {
	token0, token1, r0, r1, err := e.caller.Reserves(ctx, pair)
	if err != nil {
		return 0, 0, err
	}
	tokenDec, err := e.Decimals(ctx, token)
	if err != nil {
		return 0, 0, err
	}
	quoteDec, err := e.Decimals(ctx, quote)
	if err != nil {
		return 0, 0, err
	}

	var tokenReserve, quoteReserve *big.Int
	switch {
	case token0 == token && token1 == quote:
		tokenReserve, quoteReserve = r0, r1
	case token0 == quote && token1 == token:
		tokenReserve, quoteReserve = r1, r0
	default:
		return 0, 0, fmt.Errorf("pair %s does not hold the requested tokens", pair.Hex())
	}

	tokenAmt := Amount(tokenReserve, tokenDec)
	quoteAmt := Amount(quoteReserve, quoteDec)
	if tokenAmt <= 0 || quoteAmt <= 0 {
		return 0, 0, ErrNoRoute
	}
	return (quoteAmt / tokenAmt) * quoteUSD, quoteAmt * quoteUSD, nil
}

func (e *Engine) v3Price(ctx context.Context, pool, token, quote common.Address, quoteUSD float64) (float64, float64, error) {
	token0, token1, sqrtPriceX96, err := e.caller.Slot0SqrtPrice(ctx, pool)
	if err != nil || sqrtPriceX96 == nil || sqrtPriceX96.Sign() == 0 {
		return 0, 0, ErrNoRoute
	}
	dec0, err := e.Decimals(ctx, token0)
	if err != nil {
		return 0, 0, err
	}
	dec1, err := e.Decimals(ctx, token1)
	if err != nil {
		return 0, 0, err
	}

	// price(token0 in token1) = (sqrtPriceX96^2 / 2^192) * 10^(dec0-dec1)
	num := new(big.Float).SetInt(new(big.Int).Mul(sqrtPriceX96, sqrtPriceX96))
	den := new(big.Float).SetInt(new(big.Int).Lsh(big.NewInt(1), 192))
	ratio, _ := new(big.Float).Quo(num, den).Float64()
	price0in1 := ratio * math.Pow10(int(dec0)-int(dec1))
	if price0in1 <= 0 {
		return 0, 0, ErrNoRoute
	}

	var price float64
	switch {
	case token0 == token && token1 == quote:
		price = price0in1 * quoteUSD
	case token0 == quote && token1 == token:
		price = (1 / price0in1) * quoteUSD
	default:
		return 0, 0, fmt.Errorf("pool %s does not hold the requested tokens", pool.Hex())
	}

	quoteBal, err := e.caller.BalanceOf(ctx, quote, pool)
	if err != nil {
		return price, 0, nil
	}
	quoteDec, err := e.Decimals(ctx, quote)
	if err != nil {
		return price, 0, nil
	}
	return price, Amount(quoteBal, quoteDec) * quoteUSD, nil
}

func (e *Engine) fromLocal(token common.Address) (float64, bool) {
	e.mu.RLock()
	defer e.mu.RUnlock()
	c, ok := e.local[token]
	if !ok || time.Since(c.at) > cacheTTL {
		return 0, false
	}
	return c.price, true
}

func (e *Engine) putLocal(token common.Address, price float64) {
	e.mu.Lock()
	e.local[token] = cached{price: price, at: time.Now()}
	e.mu.Unlock()
}

func (e *Engine) cacheKey(token common.Address) string {
	return fmt.Sprintf("whaleradar:price:%d:%s", e.chain.ChainID, token.Hex())
}

func (e *Engine) fromRedis(ctx context.Context, token common.Address) (float64, bool) {
	if e.rdb == nil {
		return 0, false
	}
	v, err := e.rdb.Get(ctx, e.cacheKey(token)).Result()
	if err != nil {
		return 0, false
	}
	p, err := strconv.ParseFloat(v, 64)
	if err != nil || p <= 0 {
		return 0, false
	}
	return p, true
}

func (e *Engine) putRedis(ctx context.Context, token common.Address, price float64) {
	if e.rdb == nil {
		return
	}
	e.rdb.Set(ctx, e.cacheKey(token), strconv.FormatFloat(price, 'f', -1, 64), cacheTTL)
}

func pow10(d uint8) *big.Float {
	return new(big.Float).SetInt(new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(d)), nil))
}
