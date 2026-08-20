package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/whaleradar/listener/internal/config"
	"github.com/whaleradar/listener/internal/scoring"
	"github.com/whaleradar/listener/internal/store"
)

type server struct {
	cfg      config.Config
	pg       *store.Postgres
	rdb      *redis.Client
	logger   *slog.Logger
	adminKey string
	botToken string
	secure   bool
}

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

	s := &server{
		cfg:      cfg,
		pg:       pg,
		rdb:      rdb,
		logger:   logger,
		adminKey: os.Getenv("ADMIN_API_KEY"),
		botToken: os.Getenv("TELEGRAM_BOT_TOKEN"),
		secure:   strings.HasPrefix(os.Getenv("PUBLIC_URL"), "https://"),
	}

	srv := &http.Server{
		Addr:              cfg.APIAddr,
		Handler:           cors(s.routes()),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()

	logger.Info("whaleradar api listening", "addr", cfg.APIAddr)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		logger.Error("api server failed", "err", err)
		os.Exit(1)
	}
}

func (s *server) routes() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	mux.HandleFunc("GET /api/chains", func(w http.ResponseWriter, r *http.Request) {
		type tokenDTO struct {
			Symbol   string `json:"symbol"`
			Address  string `json:"address"`
			Decimals uint8  `json:"decimals"`
			Stable   bool   `json:"stable"`
			Native   bool   `json:"native"`
		}
		type factoryDTO struct {
			Name    string `json:"name"`
			Address string `json:"address"`
			Version string `json:"version"`
		}
		type chainDTO struct {
			ChainID   uint64       `json:"chain_id"`
			Name      string       `json:"name"`
			Slug      string       `json:"slug"`
			Explorer  string       `json:"explorer"`
			Tokens    []tokenDTO   `json:"tokens"`
			Factories []factoryDTO `json:"factories"`
		}
		out := make([]chainDTO, 0, len(config.Chains))
		for _, c := range config.Chains {
			dto := chainDTO{ChainID: c.ChainID, Name: c.Name, Slug: c.Slug, Explorer: c.Explorer}
			for _, t := range c.Tokens {
				dto.Tokens = append(dto.Tokens, tokenDTO{t.Symbol, t.Address.Hex(), t.Decimals, t.Stable, t.Native})
			}
			for _, f := range c.Factories {
				dto.Factories = append(dto.Factories, factoryDTO{f.Name, f.Address.Hex(), string(f.Version)})
			}
			out = append(out, dto)
		}
		writeJSON(w, http.StatusOK, out)
	})

	mux.HandleFunc("GET /api/stats", func(w http.ResponseWriter, r *http.Request) {
		stats, err := s.pg.Summary(r.Context())
		if err != nil {
			s.fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, stats)
	})

	mux.HandleFunc("GET /api/transfers", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		f := store.TransferFilter{
			ChainID:   uint64(intParam(q.Get("chain_id"), 0)),
			Token:     strings.TrimSpace(q.Get("token")),
			Wallet:    strings.TrimSpace(q.Get("wallet")),
			Direction: strings.TrimSpace(q.Get("direction")),
			MinUSD:    floatParam(q.Get("min_usd"), s.cfg.MinUSD),
			Since:     time.Duration(intParam(q.Get("hours"), 168)) * time.Hour,
			Limit:     intParam(q.Get("limit"), 100),
		}
		rows, err := s.pg.ListTransfers(r.Context(), f)
		if err != nil {
			s.fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	})

	mux.HandleFunc("GET /api/scores", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		rows, err := s.pg.ListScores(r.Context(), uint64(intParam(q.Get("chain_id"), 0)), intParam(q.Get("limit"), 50))
		if err != nil {
			s.fail(w, err)
			return
		}
		type scoreDTO struct {
			store.ScoreRow
			Label string `json:"label"`
		}
		out := make([]scoreDTO, 0, len(rows))
		for _, r := range rows {
			out = append(out, scoreDTO{ScoreRow: r, Label: scoring.Label(r.Score)})
		}
		writeJSON(w, http.StatusOK, out)
	})

	mux.HandleFunc("GET /api/pools", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		rows, err := s.pg.ListPools(r.Context(), uint64(intParam(q.Get("chain_id"), 0)), intParam(q.Get("limit"), 50))
		if err != nil {
			s.fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	})

	mux.HandleFunc("GET /api/alerts", func(w http.ResponseWriter, r *http.Request) {
		alerts, err := store.RecentAlerts(r.Context(), s.rdb,
			int64(intParam(r.URL.Query().Get("limit"), 50)),
			floatParam(r.URL.Query().Get("min_usd"), 0))
		if err != nil {
			s.fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, alerts)
	})

	mux.HandleFunc("GET /api/analytics", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		data, err := s.pg.AnalyticsWindow(r.Context(),
			intParam(q.Get("hours"), 24),
			uint64(intParam(q.Get("chain_id"), 0)),
			floatParam(q.Get("min_usd"), s.cfg.MinUSD))
		if err != nil {
			s.fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, data)
	})

	mux.HandleFunc("GET /api/performance", func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		rows, err := s.pg.Performance(r.Context(), intParam(q.Get("days"), 30), strings.TrimSpace(q.Get("direction")))
		if err != nil {
			s.fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	})

	mux.Handle("GET /api/outcomes", s.vipOnly(func(w http.ResponseWriter, r *http.Request) {
		rows, err := s.pg.ListOutcomes(r.Context(), intParam(r.URL.Query().Get("limit"), 50))
		if err != nil {
			s.fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, rows)
	}))

	mux.Handle("GET /api/smart-wallets", s.vipOnly(func(w http.ResponseWriter, r *http.Request) {
		rows, err := s.pg.ListSmartWallets(r.Context(), intParam(r.URL.Query().Get("limit"), 50))
		if err != nil {
			s.fail(w, err)
			return
		}
		type walletDTO struct {
			store.WalletPerf
			Label string `json:"label"`
		}
		out := make([]walletDTO, 0, len(rows))
		for _, w := range rows {
			out = append(out, walletDTO{WalletPerf: w, Label: scoring.WalletLabel(w.Score)})
		}
		writeJSON(w, http.StatusOK, out)
	}))

	s.whaleRoutes(mux)
	s.authRoutes(mux)

	// --- admin ---
	mux.Handle("GET /api/admin/users", s.admin(func(w http.ResponseWriter, r *http.Request) {
		users, err := s.pg.ListBotUsers(r.Context(), intParam(r.URL.Query().Get("limit"), 100))
		if err != nil {
			s.fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, users)
	}))

	mux.Handle("POST /api/admin/users/tier", s.admin(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			TelegramID int64  `json:"telegram_id"`
			Tier       string `json:"tier"`
			Days       int    `json:"days"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid body"})
			return
		}
		var expires *time.Time
		if body.Days > 0 {
			t := time.Now().UTC().AddDate(0, 0, body.Days)
			expires = &t
		}
		if err := s.pg.SetUserTier(r.Context(), body.TelegramID, body.Tier, expires); err != nil {
			s.fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "updated"})
	}))

	mux.Handle("POST /api/admin/tags", s.admin(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			ChainID  uint64 `json:"chain_id"`
			Address  string `json:"address"`
			Label    string `json:"label"`
			Category string `json:"category"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Address == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid body"})
			return
		}
		if err := s.pg.UpsertWalletTag(r.Context(), body.ChainID, body.Address, body.Label, body.Category); err != nil {
			s.fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "saved"})
	}))

	mux.Handle("DELETE /api/admin/tags", s.admin(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if err := s.pg.DeleteWalletTag(r.Context(), uint64(intParam(q.Get("chain_id"), 0)), q.Get("address")); err != nil {
			s.fail(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
	}))

	return mux
}

// admin guards mutating endpoints with a shared API key.
func (s *server) admin(next http.HandlerFunc) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if s.adminKey == "" || r.Header.Get("X-Admin-Key") != s.adminKey {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		next(w, r)
	})
}

func (s *server) fail(w http.ResponseWriter, err error) {
	s.logger.Error("request failed", "err", err)
	writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
}

func cors(next http.Handler) http.Handler {
	origin := os.Getenv("CORS_ORIGIN")
	if origin == "" {
		origin = "*"
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Admin-Key, Authorization")
		if origin != "*" {
			w.Header().Set("Access-Control-Allow-Credentials", "true")
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, status int, body interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func intParam(v string, def int) int {
	if n, err := strconv.Atoi(strings.TrimSpace(v)); err == nil {
		return n
	}
	return def
}

func floatParam(v string, def float64) float64 {
	if f, err := strconv.ParseFloat(strings.TrimSpace(v), 64); err == nil {
		return f
	}
	return def
}
