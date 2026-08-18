package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config holds runtime configuration shared by every binary.
type Config struct {
	PostgresDSN string
	RedisURL    string

	// MinUSD is the hard floor below which transfers are discarded.
	MinUSD float64
	// AlertUSD is the VIP threshold: transfers at or above it are VIP-tier alerts.
	AlertUSD float64
	// FreeMinUSD is the lower bound of the free-tier band [FreeMinUSD, AlertUSD).
	FreeMinUSD float64
	// UntaggedMinUSD is the alert floor for plain wallet-to-wallet, mint and
	// burn transfers. Zero (the default) keeps them out of the channels.
	UntaggedMinUSD float64
	// SellMinUSD is the alert floor for distribution flow (exchange deposits,
	// DEX sells), which is only worth a message when it is large.
	SellMinUSD float64

	APIAddr        string
	ScorerInterval time.Duration

	// EnabledChains restricts the listener to a subset of the registry.
	EnabledChains []uint64
}

// Load reads configuration from the environment, applying production defaults.
func Load() (Config, error) {
	c := Config{
		PostgresDSN:    env("POSTGRES_DSN", "postgres://whaleradar:whaleradar@localhost:5432/whaleradar?sslmode=disable"),
		RedisURL:       env("REDIS_URL", "redis://localhost:6379/0"),
		MinUSD:         envFloat("MIN_USD", 50_000),
		AlertUSD:       envFloat("ALERT_USD", 100_000),
		FreeMinUSD:     envFloat("FREE_CHANNEL_MIN_USD", 50_000),
		UntaggedMinUSD: envFloat("UNTAGGED_MIN_USD", 0),
		SellMinUSD:     envFloat("SELL_MIN_USD", 500_000),
		APIAddr:        env("API_ADDR", ":8080"),
		ScorerInterval: envDuration("SCORER_INTERVAL", 5*time.Minute),
	}

	for _, raw := range strings.Split(env("ENABLED_CHAINS", "1,56,137,42161"), ",") {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		id, err := strconv.ParseUint(raw, 10, 64)
		if err != nil {
			return Config{}, fmt.Errorf("invalid ENABLED_CHAINS entry %q: %w", raw, err)
		}
		if _, ok := ChainByID(id); !ok {
			return Config{}, fmt.Errorf("chain %d is not in the registry", id)
		}
		c.EnabledChains = append(c.EnabledChains, id)
	}
	if len(c.EnabledChains) == 0 {
		return Config{}, fmt.Errorf("ENABLED_CHAINS is empty")
	}
	return c, nil
}

// Endpoint returns the websocket and http RPC URLs configured for a chain.
func Endpoint(c Chain) (ws string, http string) {
	return os.Getenv(c.WSEnv), os.Getenv(c.HTTPEnv)
}

func env(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

func envFloat(key string, def float64) float64 {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			return f
		}
	}
	return def
}

func envDuration(key string, def time.Duration) time.Duration {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return def
}
