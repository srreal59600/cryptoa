package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/whaleradar/listener/internal/config"
	"github.com/whaleradar/listener/internal/pipeline"
	"github.com/whaleradar/listener/internal/scoring"
	"github.com/whaleradar/listener/internal/store"
)

// alertScore is the accumulation score that triggers a VIP signal.
const alertScore = 80

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

	ticker := time.NewTicker(cfg.ScorerInterval)
	defer ticker.Stop()

	logger.Info("whaleradar scorer running", "interval", cfg.ScorerInterval)
	for {
		if err := runOnce(ctx, pg, rdb, logger); err != nil {
			logger.Error("scoring cycle failed", "err", err)
		}
		select {
		case <-ctx.Done():
			logger.Info("scorer stopped")
			return
		case <-ticker.C:
		}
	}
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
