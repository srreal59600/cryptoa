package eth

import (
	"context"
	"fmt"
	"math/big"
	"sync"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"
)

// Caller performs read-only contract calls over an HTTP RPC endpoint and
// memoises immutable results (decimals, symbols, pool addresses) in memory.
type Caller struct {
	client *ethclient.Client

	mu       sync.RWMutex
	decimals map[common.Address]uint8
	symbols  map[common.Address]string
	pools    map[string]common.Address
}

// NewCaller dials an HTTP(S) JSON-RPC endpoint.
func NewCaller(ctx context.Context, httpURL string) (*Caller, error) {
	c, err := ethclient.DialContext(ctx, httpURL)
	if err != nil {
		return nil, fmt.Errorf("dial %s: %w", httpURL, err)
	}
	return &Caller{
		client:   c,
		decimals: map[common.Address]uint8{},
		symbols:  map[common.Address]string{},
		pools:    map[string]common.Address{},
	}, nil
}

// Raw exposes the underlying client for log backfills.
func (c *Caller) Raw() *ethclient.Client { return c.client }

// Close releases the RPC connection.
func (c *Caller) Close() { c.client.Close() }

func (c *Caller) call(ctx context.Context, a abi.ABI, to common.Address, method string, args ...interface{}) ([]interface{}, error) {
	data, err := a.Pack(method, args...)
	if err != nil {
		return nil, fmt.Errorf("pack %s: %w", method, err)
	}
	out, err := c.client.CallContract(ctx, ethereum.CallMsg{To: &to, Data: data}, nil)
	if err != nil {
		return nil, fmt.Errorf("call %s on %s: %w", method, to.Hex(), err)
	}
	vals, err := a.Unpack(method, out)
	if err != nil {
		return nil, fmt.Errorf("unpack %s: %w", method, err)
	}
	return vals, nil
}

// Decimals resolves and caches an ERC-20's decimals.
func (c *Caller) Decimals(ctx context.Context, token common.Address) (uint8, error) {
	c.mu.RLock()
	d, ok := c.decimals[token]
	c.mu.RUnlock()
	if ok {
		return d, nil
	}
	vals, err := c.call(ctx, ERC20ABI, token, "decimals")
	if err != nil {
		return 0, err
	}
	d, ok = vals[0].(uint8)
	if !ok {
		return 0, fmt.Errorf("decimals: unexpected type %T", vals[0])
	}
	c.mu.Lock()
	c.decimals[token] = d
	c.mu.Unlock()
	return d, nil
}

// Symbol resolves and caches an ERC-20's symbol.
func (c *Caller) Symbol(ctx context.Context, token common.Address) (string, error) {
	c.mu.RLock()
	s, ok := c.symbols[token]
	c.mu.RUnlock()
	if ok {
		return s, nil
	}
	vals, err := c.call(ctx, ERC20ABI, token, "symbol")
	if err != nil {
		return "", err
	}
	s, ok = vals[0].(string)
	if !ok {
		return "", fmt.Errorf("symbol: unexpected type %T", vals[0])
	}
	c.mu.Lock()
	c.symbols[token] = s
	c.mu.Unlock()
	return s, nil
}

// BalanceOf reads an ERC-20 balance (used to size V3 pool liquidity).
func (c *Caller) BalanceOf(ctx context.Context, token, holder common.Address) (*big.Int, error) {
	vals, err := c.call(ctx, ERC20ABI, token, "balanceOf", holder)
	if err != nil {
		return nil, err
	}
	b, ok := vals[0].(*big.Int)
	if !ok {
		return nil, fmt.Errorf("balanceOf: unexpected type %T", vals[0])
	}
	return b, nil
}

// GetPairV2 resolves a Uniswap-V2-style pair address, cached per factory.
func (c *Caller) GetPairV2(ctx context.Context, factory, a, b common.Address) (common.Address, error) {
	key := "v2:" + factory.Hex() + a.Hex() + b.Hex()
	if p, ok := c.cachedPool(key); ok {
		return p, nil
	}
	vals, err := c.call(ctx, V2FactoryABI, factory, "getPair", a, b)
	if err != nil {
		return common.Address{}, err
	}
	p, ok := vals[0].(common.Address)
	if !ok {
		return common.Address{}, fmt.Errorf("getPair: unexpected type %T", vals[0])
	}
	c.storePool(key, p)
	return p, nil
}

// GetPoolV3 resolves a Uniswap-V3-style pool address for a fee tier.
func (c *Caller) GetPoolV3(ctx context.Context, factory, a, b common.Address, fee uint32) (common.Address, error) {
	key := fmt.Sprintf("v3:%s%s%s%d", factory.Hex(), a.Hex(), b.Hex(), fee)
	if p, ok := c.cachedPool(key); ok {
		return p, nil
	}
	vals, err := c.call(ctx, V3FactoryABI, factory, "getPool", a, b, big.NewInt(int64(fee)))
	if err != nil {
		return common.Address{}, err
	}
	p, ok := vals[0].(common.Address)
	if !ok {
		return common.Address{}, fmt.Errorf("getPool: unexpected type %T", vals[0])
	}
	c.storePool(key, p)
	return p, nil
}

// Reserves reads a V2 pair's reserves together with its token ordering.
func (c *Caller) Reserves(ctx context.Context, pair common.Address) (token0, token1 common.Address, r0, r1 *big.Int, err error) {
	vals, err := c.call(ctx, V2PairABI, pair, "getReserves")
	if err != nil {
		return
	}
	var ok bool
	if r0, ok = vals[0].(*big.Int); !ok {
		err = fmt.Errorf("getReserves: unexpected reserve0 type %T", vals[0])
		return
	}
	if r1, ok = vals[1].(*big.Int); !ok {
		err = fmt.Errorf("getReserves: unexpected reserve1 type %T", vals[1])
		return
	}
	if token0, err = c.addressCall(ctx, V2PairABI, pair, "token0"); err != nil {
		return
	}
	token1, err = c.addressCall(ctx, V2PairABI, pair, "token1")
	return
}

// Slot0SqrtPrice reads a V3 pool's sqrtPriceX96 and token ordering.
func (c *Caller) Slot0SqrtPrice(ctx context.Context, pool common.Address) (token0, token1 common.Address, sqrtPriceX96 *big.Int, err error) {
	vals, err := c.call(ctx, V3PoolABI, pool, "slot0")
	if err != nil {
		return
	}
	var ok bool
	if sqrtPriceX96, ok = vals[0].(*big.Int); !ok {
		err = fmt.Errorf("slot0: unexpected sqrtPriceX96 type %T", vals[0])
		return
	}
	if token0, err = c.addressCall(ctx, V3PoolABI, pool, "token0"); err != nil {
		return
	}
	token1, err = c.addressCall(ctx, V3PoolABI, pool, "token1")
	return
}

func (c *Caller) addressCall(ctx context.Context, a abi.ABI, to common.Address, method string) (common.Address, error) {
	vals, err := c.call(ctx, a, to, method)
	if err != nil {
		return common.Address{}, err
	}
	out, ok := vals[0].(common.Address)
	if !ok {
		return common.Address{}, fmt.Errorf("%s: unexpected type %T", method, vals[0])
	}
	return out, nil
}

func (c *Caller) cachedPool(key string) (common.Address, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	p, ok := c.pools[key]
	return p, ok
}

func (c *Caller) storePool(key string, p common.Address) {
	c.mu.Lock()
	c.pools[key] = p
	c.mu.Unlock()
}
