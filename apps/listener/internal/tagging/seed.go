package tagging

import (
	"github.com/ethereum/go-ethereum/common"

	"github.com/whaleradar/listener/internal/model"
)

// seedEntry is a compact literal used to build the built-in tag list.
type seedEntry struct {
	chainID  uint64
	address  string
	label    string
	category model.WalletCategory
}

// seedEntries are the publicly documented exchange / market maker hot wallets
// shipped with the platform. They are also written to the database by
// db/migrations/0002_seed_wallet_tags.sql so operators can extend them from the
// admin panel without a redeploy.
var seedEntries = []seedEntry{
	// --- Binance (Ethereum) ---
	{1, "0x3f5CE5FBFe3E9af3971dD833D26bA9b5C936f0bE", "Binance 1", model.CategoryCEX},
	{1, "0xD551234Ae421e3BCBA99A0Da6d736074f22192FF", "Binance 2", model.CategoryCEX},
	{1, "0x564286362092D8e7936f0549571a803B203aAceD", "Binance 3", model.CategoryCEX},
	{1, "0x0681d8Db095565FE8A346fA0277bFfdE9C0eDBBF", "Binance 4", model.CategoryCEX},
	{1, "0xF977814e90dA44bFA03b6295A0616a897441aceC", "Binance 8 (Hot)", model.CategoryCEX},
	{1, "0x28C6c06298d514Db089934071355E5743bf21d60", "Binance 14 (Hot)", model.CategoryCEX},
	{1, "0x21a31Ee1afC51d94C2eFcCAa2092aD1028285549", "Binance 15 (Hot)", model.CategoryCEX},
	{1, "0xDFd5293D8e347dFe59E90eFd55b2956a1343963d", "Binance 16 (Hot)", model.CategoryCEX},
	{1, "0x56Eddb7aa87536c09CCc2793473599fD21A8b17F", "Binance 17 (Hot)", model.CategoryCEX},
	{1, "0x9696f59E4d72E237BE84fFD425DCaD154Bf96976", "Binance 18 (Hot)", model.CategoryCEX},
	// --- Binance (BSC / multi-chain reuse) ---
	{56, "0x8894E0a0c962CB723c1976a4421c95949bE2D4E3", "Binance BSC Hot", model.CategoryCEX},
	{56, "0xF977814e90dA44bFA03b6295A0616a897441aceC", "Binance 8 (Hot)", model.CategoryCEX},
	{137, "0xF977814e90dA44bFA03b6295A0616a897441aceC", "Binance 8 (Hot)", model.CategoryCEX},
	{42161, "0xF977814e90dA44bFA03b6295A0616a897441aceC", "Binance 8 (Hot)", model.CategoryCEX},

	// --- Coinbase ---
	{1, "0x71660c4005BA85c37ccec55d0C4493E66Fe775d3", "Coinbase 1", model.CategoryCEX},
	{1, "0x503828976D22510aad0201ac7EC88293211D23Da", "Coinbase 2", model.CategoryCEX},
	{1, "0xddfAbCdc4D8FfC6d5beaf154f18B778f892A0740", "Coinbase 3", model.CategoryCEX},
	{1, "0x3cD751E6b0078Be393132286c442345e5DC49699", "Coinbase 4", model.CategoryCEX},
	{1, "0xA9D1e08C7793af67e9d92fe308d5697FB81d3E43", "Coinbase 10 (Hot)", model.CategoryCEX},

	// --- Kraken ---
	{1, "0x2910543Af39abA0Cd09dBb2D50200b3E800A63D2", "Kraken 1", model.CategoryCEX},
	{1, "0x0A869d79a7052C7f1b55a8EbAbbEa3420F0D1E13", "Kraken 2", model.CategoryCEX},
	{1, "0xE853c56864A2ebe4576a807D26Fdc4A0adA51919", "Kraken 3", model.CategoryCEX},
	{1, "0x267be1C1D684F78cb4F6a176C4911b741E4Ffdc0", "Kraken 4", model.CategoryCEX},
	{1, "0xFa52274DD61E1643d2205169732f29114BC240b3", "Kraken 5", model.CategoryCEX},

	// --- Market makers ---
	{1, "0x0000006daea1723962647b7e189d311d757Fb793", "Wintermute", model.CategoryMarketMaker},
	{1, "0x4f3a120E72C76c22ae802D129F599BFDbc31cb81", "Wintermute 2", model.CategoryMarketMaker},

	// --- Burn addresses (cross-chain) ---
	{0, "0x000000000000000000000000000000000000dEaD", "Burn", model.CategoryBurn},
}

// Seed converts the literal table into wallet tags.
func Seed() []model.WalletTag {
	out := make([]model.WalletTag, 0, len(seedEntries))
	for _, e := range seedEntries {
		out = append(out, model.WalletTag{
			ChainID:  e.chainID,
			Address:  common.HexToAddress(e.address),
			Label:    e.label,
			Category: e.category,
		})
	}
	return out
}
