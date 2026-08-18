package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"sync"
	"syscall"

	"github.com/whaleradar/listener/internal/config"
	"github.com/whaleradar/listener/internal/pipeline"
	"github.com/whaleradar/listener/internal/store"
	"github.com/whaleradar/listener/internal/tagging"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: logLevel()}))
	slog.SetDefault(logger)

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

	tagger := tagging.New()
	if err := tagger.LoadFrom(ctx, pg); err != nil {
		logger.Warn("could not load wallet tags from database", "err", err)
	}

	var wg sync.WaitGroup
	started := 0
	for _, chainID := range cfg.EnabledChains {
		chain, _ := config.ChainByID(chainID)
		ws, httpURL := config.Endpoint(chain)
		if ws == "" || httpURL == "" {
			logger.Warn("skipping chain: RPC endpoints not configured",
				"chain", chain.Slug, "ws_env", chain.WSEnv, "http_env", chain.HTTPEnv)
			continue
		}
		runner, err := pipeline.NewRunner(ctx, cfg, chain, ws, httpURL, pg, rdb, tagger, logger)
		if err != nil {
			logger.Error("chain runner failed to start", "chain", chain.Slug, "err", err)
			continue
		}
		started++
		wg.Add(1)
		go func() {
			defer wg.Done()
			runner.Run(ctx)
		}()
	}

	if started == 0 {
		logger.Error("no chains started; set the *_WS_URL and *_HTTP_URL variables")
		os.Exit(1)
	}
	logger.Info("whaleradar listener running", "chains", started, "min_usd", cfg.MinUSD, "alert_usd", cfg.AlertUSD)
	wg.Wait()
	logger.Info("listener stopped")
}

func logLevel() slog.Level {
	switch os.Getenv("LOG_LEVEL") {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
