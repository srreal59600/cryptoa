package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/whaleradar/listener/internal/billing"
	"github.com/whaleradar/listener/internal/config"
	"github.com/whaleradar/listener/internal/pipeline"
	"github.com/whaleradar/listener/internal/scoring"
	"github.com/whaleradar/listener/internal/store"
)

// alertScore is the accumulation score that triggers a VIP signal.
const alertScore = 80

// Wallet track records are rebuilt from the last walletLookback of whale buys
// worth at least walletMinUSD each.
const (
	walletLookback = 30 * 24 * time.Hour
	walletMinUSD   = 25_000
)

// paymentPollInterval controls how quickly a paid invoice unlocks VIP.
const paymentPollInterval = 30 * time.Second

// pruneInterval is how often old history is swept out of Postgres.
const pruneInterval = time.Hour

// whaleRefreshInterval is how often the tracked big-account list and its
// profit/loss figures are rebuilt.
const whaleRefreshInterval = 15 * time.Minute

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))

	cfg, err := config.Load()
	if err != nil {
		logger.Error("invalid configuration", "err", err)
		os.Exit(1)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	pg, err := store.NewPostgres(ctx, cfg.PostgresDSN)
	if err != nil {
		logger.Error("postgres unavailable", "err", err)
		os.Exit(1)
	}
	defer pg.Close()

	rdb, err := store.NewRedis(ctx, cfg.RedisURL)
	if err != nil {
		logger.Error("redis unavailable", "err", err)
		os.Exit(1)
	}
	defer rdb.Close()

	startPaymentWatcher(ctx, cfg, pg, logger)

	ticker := time.NewTicker(cfg.ScorerInterval)
	defer ticker.Stop()

	var lastPrune, lastWhales time.Time
	logger.Info("whaleradar scorer running", "interval", cfg.ScorerInterval, "retention", cfg.DataRetention,
		"whale_account_min_usd", cfg.WhaleAccountMinUSD)
	for {
		if err := runOnce(ctx, pg, rdb, logger); err != nil {
			logger.Error("scoring cycle failed", "err", err)
		}
		if err := settlePerformance(ctx, pg, logger); err != nil {
			logger.Error("performance cycle failed", "err", err)
		}
		if time.Since(lastWhales) >= whaleRefreshInterval {
			lastWhales = time.Now()
			if err := refreshWhales(ctx, cfg, pg, logger); err != nil {
				logger.Error("whale account refresh failed", "err", err)
			}
		}
		if time.Since(lastPrune) >= pruneInterval {
			lastPrune = time.Now()
			if rows, err := pg.Prune(ctx, cfg.DataRetention); err != nil {
				logger.Error("prune failed", "err", err)
			} else if rows > 0 {
				logger.Info("pruned old history", "rows", rows, "retention", cfg.DataRetention)
			}
		}
		select {
		case <-ctx.Done():
			logger.Info("scorer stopped")
			return
		case <-ticker.C:
		}
	}
}

// startPaymentWatcher credits USDT subscription payments in the background.
func startPaymentWatcher(ctx context.Context, cfg config.Config, pg *store.Postgres, logger *slog.Logger) {
	if !cfg.PaymentsEnabled() {
		logger.Info("payments disabled, PAYMENT_ADDRESS is empty")
		return
	}
	reader, err := billing.NewReader(cfg)
	if err != nil {
		logger.Error("payment watcher disabled", "err", err)
		return
	}
	watcher := billing.NewWatcher(pg, reader, logger, nil)
	logger.Info("payment watcher running", "network", reader.Network(), "price_usd", cfg.VIPPriceUSD)
	go watcher.Run(ctx, paymentPollInterval)
}

// settlePerformance closes out the forward returns of published alerts and
// rebuilds the wallet track records that power the smart-money score.
func settlePerformance(ctx context.Context, pg *store.Postgres, logger *slog.Logger) error {
	settled, err := pg.SettleOutcomes(ctx)
	if err != nil {
		return err
	}

	wallets, err := pg.WalletPerformance(ctx, walletLookback, walletMinUSD)
	if err != nil {
		return err
	}
	for _, w := range wallets {
		w.Score = scoring.ScoreWallet(w)
		if err := pg.UpsertWalletScore(ctx, w); err != nil {
			logger.Warn("storing wallet score failed", "wallet", w.Address, "err", err)
		}
	}
	logger.Info("performance cycle complete", "settled_alerts", settled, "wallets", len(wallets))
	return nil
}

// refreshWhales rebuilds the list of accounts big enough to follow move by
// move, then marks their window to market so VIPs see what those accounts made.
func refreshWhales(ctx context.Context, cfg config.Config, pg *store.Postgres, logger *slog.Logger) error {
	n, err := pg.RefreshWhaleAccounts(ctx, cfg.WhaleAccountWindow, cfg.WhaleAccountMinUSD)
	if err != nil {
		return err
	}
	if err := pg.RefreshWhalePnL(ctx, cfg.WhaleAccountWindow); err != nil {
		return err
	}
	logger.Info("whale accounts refreshed", "accounts", n, "min_usd", cfg.WhaleAccountMinUSD)
	return nil
}

func runOnce(ctx context.Context, pg *store.Postgres, rdb *redis.Client, logger *slog.Logger) error {
	inputs, err := pg.AggregateWindow(ctx, 24*time.Hour)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	for _, in := range inputs {
		s := scoring.Compute(in, now)
		if err := pg.UpsertScore(ctx, s); err != nil {
			logger.Warn("storing score failed", "token", in.Token, "err", err)
			continue
		}
		// Only alert when a token crosses into the accumulation regime.
		if s.Score >= alertScore && in.PreviousScore < alertScore {
			chain, ok := config.ChainByID(s.ChainID)
			if !ok {
				continue
			}
			if err := pipeline.PublishScoreAlert(ctx, rdb, chain, s); err != nil {
				logger.Warn("publishing score alert failed", "token", in.Token, "err", err)
			}
		}
	}
	logger.Info("scoring cycle complete", "tokens", len(inputs))
	return nil
}
