// Package billing settles VIP subscriptions paid in USDT by matching the exact
// invoice amount against incoming transfers to the receiving address.
package billing

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"math"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"

	"github.com/whaleradar/listener/internal/config"
	"github.com/whaleradar/listener/internal/eth"
	"github.com/whaleradar/listener/internal/store"
)

// amountTolerance absorbs rounding by exchanges; invoices are spaced one cent apart.
const amountTolerance = 0.004

// maxOverpay is how much more than the invoice a transfer may carry and still
// settle it. Senders often round up or absorb a withdrawal fee, but a much
// larger deposit is somebody else's money and must not credit a stranger.
const maxOverpay = 1.0

// evmNetworks maps a payment network name to the chain carrying its USDT contract.
var evmNetworks = map[string]uint64{
	"ethereum": 1,
	"eth":      1,
	"erc20":    1,
	"bsc":      56,
	"bep20":    56,
	"polygon":  137,
	"arbitrum": 42161,
}

// Payment is an incoming USDT transfer seen on the receiving address.
type Payment struct {
	TxHash string
	Amount float64
	Seen   time.Time
}

// Reader returns recent USDT payments credited to the receiving address.
type Reader interface {
	Recent(ctx context.Context, since time.Time) ([]Payment, error)
	Network() string
}

// NewReader builds the payment reader for the configured network.
func NewReader(cfg config.Config) (Reader, error) {
	network := strings.ToLower(strings.TrimSpace(cfg.PaymentNetwork))
	if cfg.PaymentAddress == "" {
		return nil, fmt.Errorf("PAYMENT_ADDRESS is not set")
	}
	if network == "tron" || network == "trc20" {
		return &tronReader{address: cfg.PaymentAddress, client: &http.Client{Timeout: 15 * time.Second}}, nil
	}
	chainID, ok := evmNetworks[network]
	if !ok {
		return nil, fmt.Errorf("unsupported PAYMENT_NETWORK %q", cfg.PaymentNetwork)
	}
	chain, ok := config.ChainByID(chainID)
	if !ok {
		return nil, fmt.Errorf("chain %d missing from registry", chainID)
	}
	_, httpURL := config.Endpoint(chain)
	if httpURL == "" {
		return nil, fmt.Errorf("%s is not set for payment network %s", chain.HTTPEnv, network)
	}
	var usdt config.Token
	for _, t := range chain.Tokens {
		if t.Symbol == "USDT" {
			usdt = t
		}
	}
	if (usdt.Address == common.Address{}) {
		return nil, fmt.Errorf("USDT is not registered on chain %d", chainID)
	}
	return &evmReader{
		network:  network,
		rpcURL:   httpURL,
		token:    usdt,
		receiver: common.HexToAddress(cfg.PaymentAddress),
	}, nil
}

// Watcher credits paid invoices and expires stale ones.
type Watcher struct {
	pg     *store.Postgres
	reader Reader
	logger *slog.Logger
	notify func(telegramID int64, days int)
}

// NewWatcher wires a reader to the invoice store. notify may be nil.
func NewWatcher(pg *store.Postgres, reader Reader, logger *slog.Logger, notify func(int64, int)) *Watcher {
	return &Watcher{pg: pg, reader: reader, logger: logger, notify: notify}
}

// Run polls for payments until the context is cancelled.
func (w *Watcher) Run(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		if err := w.Tick(ctx); err != nil {
			w.logger.Warn("payment poll failed", "network", w.reader.Network(), "err", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// Tick matches one batch of on-chain payments to pending invoices.
func (w *Watcher) Tick(ctx context.Context) error {
	if _, err := w.pg.ExpireInvoices(ctx); err != nil {
		return err
	}
	if _, err := w.pg.ExpireSubscriptions(ctx); err != nil {
		return err
	}

	invoices, err := w.pg.PendingInvoices(ctx)
	if err != nil {
		return err
	}
	if len(invoices) == 0 {
		return nil
	}

	oldest := invoices[0].CreatedAt
	payments, err := w.reader.Recent(ctx, oldest.Add(-10*time.Minute))
	if err != nil {
		return err
	}

	// A transfer that already paid an invoice must never be credited twice.
	used, err := w.pg.SettledTxHashes(ctx)
	if err != nil {
		return err
	}

	settled := map[int64]struct{}{}
	for _, p := range payments {
		if _, seen := used[strings.ToLower(p.TxHash)]; seen {
			continue
		}
		inv, ok := match(invoices, settled, p)
		if !ok {
			w.logger.Warn("payment did not match any invoice",
				"tx", p.TxHash, "amount", p.Amount, "network", w.reader.Network())
			continue
		}
		if err := w.pg.MarkInvoicePaid(ctx, inv.ID, p.TxHash); err != nil {
			return err
		}
		used[strings.ToLower(p.TxHash)] = struct{}{}
		settled[inv.ID] = struct{}{}
		w.logger.Info("invoice settled", "invoice", inv.ID, "user", inv.TelegramID,
			"tx", p.TxHash, "paid", p.Amount, "due", inv.AmountUSDT)
		if w.notify != nil {
			w.notify(inv.TelegramID, inv.Days)
		}
	}
	return nil
}

// match picks the invoice a payment settles: the largest one it fully covers.
// Paying a cent too little leaves the invoice open on purpose, because the cents
// are what identify the payer.
func match(invoices []store.Invoice, settled map[int64]struct{}, p Payment) (store.Invoice, bool) {
	var best store.Invoice
	found := false
	for _, inv := range invoices {
		if _, done := settled[inv.ID]; done {
			continue
		}
		if p.Seen.Before(inv.CreatedAt.Add(-10 * time.Minute)) {
			continue
		}
		if p.Amount < inv.AmountUSDT-amountTolerance || p.Amount > inv.AmountUSDT+maxOverpay {
			continue
		}
		if !found || inv.AmountUSDT > best.AmountUSDT {
			best, found = inv, true
		}
	}
	return best, found
}

// --- EVM (ERC-20 / BEP-20 USDT) ---

type evmReader struct {
	network  string
	rpcURL   string
	token    config.Token
	receiver common.Address
}

func (r *evmReader) Network() string { return r.network }

func (r *evmReader) Recent(ctx context.Context, since time.Time) ([]Payment, error) {
	client, err := ethclient.DialContext(ctx, r.rpcURL)
	if err != nil {
		return nil, err
	}
	defer client.Close()

	head, err := client.BlockNumber(ctx)
	if err != nil {
		return nil, err
	}
	blocks := uint64(time.Since(since)/blockTime(r.network)) + 10
	if blocks > 5000 {
		blocks = 5000
	}
	from := uint64(0)
	if head > blocks {
		from = head - blocks
	}

	logs, err := client.FilterLogs(ctx, ethereum.FilterQuery{
		FromBlock: new(big.Int).SetUint64(from),
		ToBlock:   new(big.Int).SetUint64(head),
		Addresses: []common.Address{r.token.Address},
		Topics: [][]common.Hash{
			{eth.TopicTransfer},
			nil,
			{common.BytesToHash(r.receiver.Bytes())},
		},
	})
	if err != nil {
		return nil, err
	}

	scale := math.Pow10(int(r.token.Decimals))
	out := make([]Payment, 0, len(logs))
	for _, l := range logs {
		value := new(big.Int).SetBytes(l.Data)
		amount, _ := new(big.Float).Quo(new(big.Float).SetInt(value), big.NewFloat(scale)).Float64()
		out = append(out, Payment{TxHash: l.TxHash.Hex(), Amount: amount, Seen: time.Now().UTC()})
	}
	return out, nil
}

// blockTime is the average block interval used to size the log window.
func blockTime(network string) time.Duration {
	switch network {
	case "bsc", "bep20":
		return 3 * time.Second
	case "polygon":
		return 2 * time.Second
	case "arbitrum":
		return 250 * time.Millisecond
	default:
		return 12 * time.Second
	}
}

// --- TRON (TRC-20 USDT via TronGrid) ---

const tronUSDT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"

// tronAPIKey is optional; TronGrid allows a low anonymous rate limit without it.
func tronAPIKey() string { return os.Getenv("TRONGRID_API_KEY") }

type tronReader struct {
	address string
	client  *http.Client
}

func (r *tronReader) Network() string { return "tron" }

func (r *tronReader) Recent(ctx context.Context, since time.Time) ([]Payment, error) {
	endpoint := fmt.Sprintf("https://api.trongrid.io/v1/accounts/%s/transactions/trc20?%s",
		url.PathEscape(r.address), url.Values{
			"only_confirmed":   {"true"},
			"only_to":          {"true"},
			"contract_address": {tronUSDT},
			"min_timestamp":    {strconv.FormatInt(since.UnixMilli(), 10)},
			"limit":            {"100"},
		}.Encode())

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	if key := strings.TrimSpace(tronAPIKey()); key != "" {
		req.Header.Set("TRON-PRO-API-KEY", key)
	}

	resp, err := r.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("trongrid returned %s", resp.Status)
	}

	var body struct {
		Data []struct {
			TransactionID  string `json:"transaction_id"`
			Value          string `json:"value"`
			BlockTimestamp int64  `json:"block_timestamp"`
			To             string `json:"to"`
			TokenInfo      struct {
				Decimals int `json:"decimals"`
			} `json:"token_info"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, err
	}

	out := make([]Payment, 0, len(body.Data))
	for _, tx := range body.Data {
		if !strings.EqualFold(tx.To, r.address) {
			continue
		}
		raw, ok := new(big.Int).SetString(tx.Value, 10)
		if !ok {
			continue
		}
		decimals := tx.TokenInfo.Decimals
		if decimals == 0 {
			decimals = 6
		}
		amount, _ := new(big.Float).Quo(new(big.Float).SetInt(raw), big.NewFloat(math.Pow10(decimals))).Float64()
		out = append(out, Payment{
			TxHash: tx.TransactionID,
			Amount: amount,
			Seen:   time.UnixMilli(tx.BlockTimestamp).UTC(),
		})
	}
	return out, nil
}
