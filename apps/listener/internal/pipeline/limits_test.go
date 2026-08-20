package pipeline

import (
	"testing"

	"github.com/ethereum/go-ethereum/common"

	"github.com/whaleradar/listener/internal/config"
	"github.com/whaleradar/listener/internal/model"
)

func TestAlertLimit(t *testing.T) {
	chain, ok := config.ChainByID(1)
	if !ok {
		t.Fatal("ethereum missing from registry")
	}
	limits := config.AlertLimits{
		StableKnown: 100, StableUnknown: 200, StableMint: 1000,
		MajorKnown: 50, MajorUnknown: 100,
		TokenKnown: 20, TokenUnknown: 50,
	}
	token := func(symbol string) common.Address {
		for _, tok := range chain.Tokens {
			if tok.Symbol == symbol {
				return tok.Address
			}
		}
		t.Fatalf("%s missing from registry", symbol)
		return common.Address{}
	}
	tag := &model.WalletTag{Label: "Binance"}

	cases := []struct {
		name string
		tr   model.Transfer
		want float64
	}{
		{"stable between anonymous wallets", model.Transfer{Token: token("USDT")}, 200},
		{"stable from a labelled exchange", model.Transfer{Token: token("USDT"), FromTag: tag}, 100},
		{"stable mint", model.Transfer{Token: token("USDT"), Direction: model.DirMint}, 1000},
		{"native between anonymous wallets", model.Transfer{Token: token("WETH")}, 100},
		{"native into a labelled wallet", model.Transfer{Token: token("WETH"), ToTag: tag}, 50},
		{"erc20 between anonymous wallets", model.Transfer{Token: token("LINK")}, 50},
		{"erc20 with a labelled side", model.Transfer{Token: token("LINK"), ToTag: tag}, 20},
		{"unregistered token", model.Transfer{Token: common.HexToAddress("0xdead")}, 50},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := AlertLimit(chain, limits, tc.tr); got != tc.want {
				t.Fatalf("limit = %v, want %v", got, tc.want)
			}
		})
	}
}
