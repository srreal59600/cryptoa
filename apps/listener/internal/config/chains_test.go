package config

import (
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
)

// want mirrors the contract registry specification. It guards against typos in
// the registry literals.
var want = map[uint64]map[string]struct {
	address  string
	decimals uint8
}{
	1: {
		"WETH": {"0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", 18},
		"USDT": {"0xdAC17F958D2ee523a2206206994597C13D831ec7", 6},
		"USDC": {"0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 6},
		"DAI":  {"0x6B175474E89094C44Da98b954EedeAC495271d0F", 18},
		"WBTC": {"0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", 8},
		"LINK": {"0x514910771af9ca656af840dff83e8264ecf986ca", 18},
		"PEPE": {"0x6982508145454ce325ddbe47a25d4ec3d2311933", 18},
	},
	56: {
		"WBNB": {"0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", 18},
		"USDT": {"0x55d398326f99059fF775485246999027B3197955", 18},
		"USDC": {"0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", 18},
	},
	137: {
		"WPOL": {"0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270", 18},
		"USDT": {"0xc2132D05D31c914a87C6611C10748AEb04B58e8F", 6},
		"USDC": {"0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", 6},
	},
	42161: {
		"WETH": {"0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", 18},
		"USDC": {"0xaf88d065e77c8cC2239327C5EDb3A432268e5831", 6},
		"USDT": {"0xFd086bC7cd5C481DCC9C85ebE478A1C0b69FCbb9", 6},
	},
}

var wantFactories = map[uint64]map[string]string{
	1: {
		"Uniswap V2": "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f",
		"Uniswap V3": "0x1F98431c8aD98523631AE4a59f267346ea31F984",
	},
	56: {
		"PancakeSwap V2": "0xcA143Ce32Fe78f1f7019d7d551a6402fc5350c73",
		"PancakeSwap V3": "0x0BFbCFFAFA4533d5f6f539420a87aE3224213192",
	},
	137: {
		"QuickSwap V2": "0x5757371414417b7702ED1a912380ec961e188671",
		"Uniswap V3":   "0x1F98431c8aD98523631AE4a59f267346ea31F984",
	},
	42161: {
		"Camelot V2": "0x6Ec48B24f682A38d2190777f09c316499500f6ff",
		"Uniswap V3": "0x1F98431c8aD98523631AE4a59f267346ea31F984",
	},
}

func TestRegistryMatchesSpecification(t *testing.T) {
	for chainID, tokens := range want {
		chain, ok := ChainByID(chainID)
		if !ok {
			t.Fatalf("chain %d missing from registry", chainID)
		}
		index := map[string]Token{}
		for _, tok := range chain.Tokens {
			index[tok.Symbol] = tok
		}
		for symbol, exp := range tokens {
			got, ok := index[symbol]
			if !ok {
				t.Errorf("chain %d: token %s missing", chainID, symbol)
				continue
			}
			if got.Address != common.HexToAddress(exp.address) {
				t.Errorf("chain %d %s: address %s, want %s", chainID, symbol, got.Address.Hex(), exp.address)
			}
			if got.Decimals != exp.decimals {
				t.Errorf("chain %d %s: decimals %d, want %d", chainID, symbol, got.Decimals, exp.decimals)
			}
		}
	}
}

func TestFactoriesMatchSpecification(t *testing.T) {
	for chainID, factories := range wantFactories {
		chain, ok := ChainByID(chainID)
		if !ok {
			t.Fatalf("chain %d missing from registry", chainID)
		}
		index := map[string]Factory{}
		for _, f := range chain.Factories {
			index[f.Name] = f
		}
		for name, addrHex := range factories {
			got, ok := index[name]
			if !ok {
				t.Errorf("chain %d: factory %s missing", chainID, name)
				continue
			}
			if got.Address != common.HexToAddress(addrHex) {
				t.Errorf("chain %d %s: address %s, want %s", chainID, name, got.Address.Hex(), addrHex)
			}
			if strings.HasSuffix(name, "V2") && got.Version != DexV2 {
				t.Errorf("chain %d %s: expected v2 version, got %s", chainID, name, got.Version)
			}
			if strings.HasSuffix(name, "V3") && got.Version != DexV3 {
				t.Errorf("chain %d %s: expected v3 version, got %s", chainID, name, got.Version)
			}
		}
	}
}

func TestEveryChainHasNativeAndStables(t *testing.T) {
	for _, c := range Chains {
		if _, ok := c.NativeToken(); !ok {
			t.Errorf("chain %d has no wrapped native token", c.ChainID)
		}
		if len(c.Stables()) == 0 {
			t.Errorf("chain %d has no stable anchor", c.ChainID)
		}
	}
}
