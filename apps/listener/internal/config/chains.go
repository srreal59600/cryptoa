package config

import "github.com/ethereum/go-ethereum/common"

// DexVersion distinguishes the two factory/pool layouts we support.
type DexVersion string

const (
	DexV2 DexVersion = "v2"
	DexV3 DexVersion = "v3"
)

// Token is a tracked ERC-20 with its exact on-chain decimals.
type Token struct {
	Symbol   string
	Address  common.Address
	Decimals uint8
	// Stable marks USD-pegged tokens used as the pricing anchor.
	Stable bool
	// Native marks the chain's wrapped native asset (WETH/WBNB/WMATIC).
	Native bool
}

// Factory is a DEX factory contract emitting PairCreated / PoolCreated.
type Factory struct {
	Name    string
	Address common.Address
	Version DexVersion
}

// Chain is a full per-network registry entry.
type Chain struct {
	ChainID   uint64
	Name      string
	Slug      string
	Explorer  string
	WSEnv     string
	HTTPEnv   string
	Tokens    []Token
	Factories []Factory
}

func addr(s string) common.Address { return common.HexToAddress(s) }

// Chains is the static multi-chain contract registry. Addresses are checksummed
// on load via common.HexToAddress, so casing in the literals is irrelevant.
var Chains = []Chain{
	{
		ChainID:  1,
		Name:     "Ethereum Mainnet",
		Slug:     "ethereum",
		Explorer: "https://etherscan.io",
		WSEnv:    "ETH_WS_URL",
		HTTPEnv:  "ETH_HTTP_URL",
		Tokens: []Token{
			{Symbol: "WETH", Address: addr("0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"), Decimals: 18, Native: true},
			{Symbol: "USDT", Address: addr("0xdAC17F958D2ee523a2206206994597C13D831ec7"), Decimals: 6, Stable: true},
			{Symbol: "USDC", Address: addr("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"), Decimals: 6, Stable: true},
			{Symbol: "DAI", Address: addr("0x6B175474E89094C44Da98b954EedeAC495271d0F"), Decimals: 18, Stable: true},
			{Symbol: "WBTC", Address: addr("0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599"), Decimals: 8},
			{Symbol: "LINK", Address: addr("0x514910771af9ca656af840dff83e8264ecf986ca"), Decimals: 18},
			{Symbol: "PEPE", Address: addr("0x6982508145454ce325ddbe47a25d4ec3d2311933"), Decimals: 18},
		},
		Factories: []Factory{
			{Name: "Uniswap V2", Address: addr("0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f"), Version: DexV2},
			{Name: "Uniswap V3", Address: addr("0x1F98431c8aD98523631AE4a59f267346ea31F984"), Version: DexV3},
		},
	},
	{
		ChainID:  56,
		Name:     "BNB Smart Chain",
		Slug:     "bsc",
		Explorer: "https://bscscan.com",
		WSEnv:    "BSC_WS_URL",
		HTTPEnv:  "BSC_HTTP_URL",
		Tokens: []Token{
			{Symbol: "WBNB", Address: addr("0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"), Decimals: 18, Native: true},
			{Symbol: "USDT", Address: addr("0x55d398326f99059fF775485246999027B3197955"), Decimals: 18, Stable: true},
			{Symbol: "USDC", Address: addr("0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d"), Decimals: 18, Stable: true},
		},
		Factories: []Factory{
			{Name: "PancakeSwap V2", Address: addr("0xcA143Ce32Fe78f1f7019d7d551a6402fc5350c73"), Version: DexV2},
			{Name: "PancakeSwap V3", Address: addr("0x0BFbCFFAFA4533d5f6f539420a87aE3224213192"), Version: DexV3},
		},
	},
	{
		ChainID:  137,
		Name:     "Polygon",
		Slug:     "polygon",
		Explorer: "https://polygonscan.com",
		WSEnv:    "POLYGON_WS_URL",
		HTTPEnv:  "POLYGON_HTTP_URL",
		Tokens: []Token{
			{Symbol: "WPOL", Address: addr("0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270"), Decimals: 18, Native: true},
			{Symbol: "USDT", Address: addr("0xc2132D05D31c914a87C6611C10748AEb04B58e8F"), Decimals: 6, Stable: true},
			{Symbol: "USDC", Address: addr("0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"), Decimals: 6, Stable: true},
		},
		Factories: []Factory{
			{Name: "QuickSwap V2", Address: addr("0x5757371414417b7702ED1a912380ec961e188671"), Version: DexV2},
			{Name: "Uniswap V3", Address: addr("0x1F98431c8aD98523631AE4a59f267346ea31F984"), Version: DexV3},
		},
	},
	{
		ChainID:  42161,
		Name:     "Arbitrum One",
		Slug:     "arbitrum",
		Explorer: "https://arbiscan.io",
		WSEnv:    "ARBITRUM_WS_URL",
		HTTPEnv:  "ARBITRUM_HTTP_URL",
		Tokens: []Token{
			{Symbol: "WETH", Address: addr("0x82aF49447D8a07e3bd95BD0d56f35241523fBab1"), Decimals: 18, Native: true},
			{Symbol: "USDC", Address: addr("0xaf88d065e77c8cC2239327C5EDb3A432268e5831"), Decimals: 6, Stable: true},
			{Symbol: "USDT", Address: addr("0xFd086bC7cd5C481DCC9C85ebE478A1C0b69FCbb9"), Decimals: 6, Stable: true},
		},
		Factories: []Factory{
			{Name: "Camelot V2", Address: addr("0x6Ec48B24f682A38d2190777f09c316499500f6ff"), Version: DexV2},
			{Name: "Uniswap V3", Address: addr("0x1F98431c8aD98523631AE4a59f267346ea31F984"), Version: DexV3},
		},
	},
}

// ChainByID returns the registry entry for a chain id.
func ChainByID(id uint64) (Chain, bool) {
	for _, c := range Chains {
		if c.ChainID == id {
			return c, true
		}
	}
	return Chain{}, false
}

// TokenIndex builds an address -> token lookup for a chain.
func (c Chain) TokenIndex() map[common.Address]Token {
	m := make(map[common.Address]Token, len(c.Tokens))
	for _, t := range c.Tokens {
		m[t.Address] = t
	}
	return m
}

// FactoryIndex builds an address -> factory lookup for a chain.
func (c Chain) FactoryIndex() map[common.Address]Factory {
	m := make(map[common.Address]Factory, len(c.Factories))
	for _, f := range c.Factories {
		m[f.Address] = f
	}
	return m
}

// NativeToken returns the wrapped native asset of the chain.
func (c Chain) NativeToken() (Token, bool) {
	for _, t := range c.Tokens {
		if t.Native {
			return t, true
		}
	}
	return Token{}, false
}

// Stables returns the USD-pegged tokens of the chain.
func (c Chain) Stables() []Token {
	var out []Token
	for _, t := range c.Tokens {
		if t.Stable {
			out = append(out, t)
		}
	}
	return out
}
