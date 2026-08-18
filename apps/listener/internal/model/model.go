package model

import (
	"math/big"
	"time"

	"github.com/ethereum/go-ethereum/common"
)

// WalletCategory classifies a tagged address.
type WalletCategory string

const (
	CategoryCEX         WalletCategory = "cex"
	CategoryMarketMaker WalletCategory = "market_maker"
	CategoryDexPool     WalletCategory = "dex_pool"
	CategoryBridge      WalletCategory = "bridge"
	CategoryBurn        WalletCategory = "burn"
	CategoryUnknown     WalletCategory = "unknown"
)

// WalletTag is a human label attached to an address.
type WalletTag struct {
	ChainID  uint64
	Address  common.Address
	Label    string
	Category WalletCategory
}

// Direction is the interpreted money-flow direction of a transfer.
type Direction string

const (
	DirCEXDeposit    Direction = "cex_deposit"    // wallet -> exchange (bearish)
	DirCEXWithdrawal Direction = "cex_withdrawal" // exchange -> wallet (bullish)
	DirDexBuy        Direction = "dex_buy"        // pool -> wallet (bullish)
	DirDexSell       Direction = "dex_sell"       // wallet -> pool (bearish)
	DirMint          Direction = "mint"
	DirBurn          Direction = "burn"
	DirWallet        Direction = "wallet_transfer"
)

// Transfer is a normalised, USD-priced ERC-20 transfer.
type Transfer struct {
	ChainID     uint64
	ChainSlug   string
	TxHash      common.Hash
	LogIndex    uint
	BlockNumber uint64
	SeenAt      time.Time

	Token         common.Address
	TokenSymbol   string
	TokenDecimals uint8

	From common.Address
	To   common.Address

	Raw       *big.Int
	Amount    float64
	PriceUSD  float64
	AmountUSD float64

	FromTag   *WalletTag
	ToTag     *WalletTag
	Direction Direction
}

// PoolRef is a DEX pool discovered from PairCreated / PoolCreated.
type PoolRef struct {
	ChainID   uint64
	Address   common.Address
	Factory   common.Address
	Dex       string
	Version   string
	Token0    common.Address
	Token1    common.Address
	FeeTier   uint32
	CreatedAt time.Time
	Block     uint64
	TxHash    common.Hash
}

// Alert is the payload published to Redis and consumed by the Telegram bot.
type Alert struct {
	ID          string    `json:"id"`
	Kind        string    `json:"kind"` // whale_transfer | new_pool | accumulation
	Tier        string    `json:"tier"` // vip | free
	ChainID     uint64    `json:"chain_id"`
	Chain       string    `json:"chain"`
	Explorer    string    `json:"explorer"`
	TxHash      string    `json:"tx_hash"`
	Token       string    `json:"token"`
	TokenSymbol string    `json:"token_symbol"`
	From        string    `json:"from"`
	To          string    `json:"to"`
	FromLabel   string    `json:"from_label"`
	ToLabel     string    `json:"to_label"`
	Direction   string    `json:"direction"`
	Amount      float64   `json:"amount"`
	AmountUSD   float64   `json:"amount_usd"`
	PriceUSD    float64   `json:"price_usd"`
	Score       float64   `json:"score"`
	Note        string    `json:"note"`
	CreatedAt   time.Time `json:"created_at"`

	// 24h context attached to whale transfer alerts so a reader can judge the
	// trade instead of reacting to a single isolated transaction.
	NetAccum24hUSD float64 `json:"net_accum_24h_usd"`
	Buyers24h      int     `json:"buyers_24h"`
	WhaleTx24h     int     `json:"whale_tx_24h"`
	Verdict        string  `json:"verdict"`
}

// TokenScore is the 24h accumulation snapshot for one token on one chain.
type TokenScore struct {
	ChainID        uint64    `json:"chain_id"`
	Token          string    `json:"token"`
	Symbol         string    `json:"symbol"`
	Score          float64   `json:"score"`
	DexBuyUSD      float64   `json:"dex_buy_usd"`
	DexSellUSD     float64   `json:"dex_sell_usd"`
	CEXInflowUSD   float64   `json:"cex_inflow_usd"`
	CEXOutflowUSD  float64   `json:"cex_outflow_usd"`
	UniqueBuyers   int       `json:"unique_buyers"`
	WhaleTxCount   int       `json:"whale_tx_count"`
	NetAccumUSD    float64   `json:"net_accum_usd"`
	ComputedAt     time.Time `json:"computed_at"`
	PreviousScore  float64   `json:"previous_score"`
	ScoreDelta24h  float64   `json:"score_delta_24h"`
	LargestTradeUS float64   `json:"largest_trade_usd"`
}
