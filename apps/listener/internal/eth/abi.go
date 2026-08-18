package eth

import (
	"strings"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
)

// Event topics we listen for across every chain.
var (
	TopicTransfer    = crypto.Keccak256Hash([]byte("Transfer(address,address,uint256)"))
	TopicPairCreated = common.HexToHash("0x0d3648d313269e3c74d9709392ed51d7392214187010a3ba05b807a339f239e7")
	TopicPoolCreated = common.HexToHash("0x783edd98122f3285c50e6f8e5478d0bae9590761be1525708d32e62c18e2421e")
)

const (
	erc20ABIJSON = `[
	{"name":"decimals","type":"function","stateMutability":"view","inputs":[],"outputs":[{"type":"uint8"}]},
	{"name":"symbol","type":"function","stateMutability":"view","inputs":[],"outputs":[{"type":"string"}]},
	{"name":"balanceOf","type":"function","stateMutability":"view","inputs":[{"type":"address"}],"outputs":[{"type":"uint256"}]},
	{"name":"Transfer","type":"event","anonymous":false,"inputs":[
		{"name":"from","type":"address","indexed":true},
		{"name":"to","type":"address","indexed":true},
		{"name":"value","type":"uint256","indexed":false}]}]`

	v2FactoryABIJSON = `[
	{"name":"getPair","type":"function","stateMutability":"view","inputs":[{"type":"address"},{"type":"address"}],"outputs":[{"type":"address"}]},
	{"name":"PairCreated","type":"event","anonymous":false,"inputs":[
		{"name":"token0","type":"address","indexed":true},
		{"name":"token1","type":"address","indexed":true},
		{"name":"pair","type":"address","indexed":false},
		{"name":"allPairsLength","type":"uint256","indexed":false}]}]`

	v2PairABIJSON = `[
	{"name":"getReserves","type":"function","stateMutability":"view","inputs":[],"outputs":[{"type":"uint112"},{"type":"uint112"},{"type":"uint32"}]},
	{"name":"token0","type":"function","stateMutability":"view","inputs":[],"outputs":[{"type":"address"}]},
	{"name":"token1","type":"function","stateMutability":"view","inputs":[],"outputs":[{"type":"address"}]}]`

	v3FactoryABIJSON = `[
	{"name":"getPool","type":"function","stateMutability":"view","inputs":[{"type":"address"},{"type":"address"},{"type":"uint24"}],"outputs":[{"type":"address"}]},
	{"name":"PoolCreated","type":"event","anonymous":false,"inputs":[
		{"name":"token0","type":"address","indexed":true},
		{"name":"token1","type":"address","indexed":true},
		{"name":"fee","type":"uint24","indexed":true},
		{"name":"tickSpacing","type":"int24","indexed":false},
		{"name":"pool","type":"address","indexed":false}]}]`

	v3PoolABIJSON = `[
	{"name":"slot0","type":"function","stateMutability":"view","inputs":[],"outputs":[
		{"type":"uint160"},{"type":"int24"},{"type":"uint16"},{"type":"uint16"},{"type":"uint16"},{"type":"uint8"},{"type":"bool"}]},
	{"name":"token0","type":"function","stateMutability":"view","inputs":[],"outputs":[{"type":"address"}]},
	{"name":"token1","type":"function","stateMutability":"view","inputs":[],"outputs":[{"type":"address"}]}]`
)

// Parsed ABIs reused by the RPC helpers.
var (
	ERC20ABI     = mustABI(erc20ABIJSON)
	V2FactoryABI = mustABI(v2FactoryABIJSON)
	V2PairABI    = mustABI(v2PairABIJSON)
	V3FactoryABI = mustABI(v3FactoryABIJSON)
	V3PoolABI    = mustABI(v3PoolABIJSON)
)

// V3FeeTiers are probed in order when resolving a Uniswap V3 style pool.
var V3FeeTiers = []uint32{500, 3000, 10000, 100}

func mustABI(s string) abi.ABI {
	a, err := abi.JSON(strings.NewReader(s))
	if err != nil {
		panic(err)
	}
	return a
}
