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
	// Limits are the published-alert floors per asset class.
	Limits AlertLimits

	APIAddr        string
	ScorerInterval time.Duration
	// DataRetention is how long raw transfer history is kept. Zero disables
	// pruning. Alert outcomes and wallet scores are never pruned.
	DataRetention time.Duration

	// WhaleAccountMinUSD is the volume, moved over WhaleAccountWindow, that
	// promotes a wallet to a tracked whale account followed move by move.
	WhaleAccountMinUSD float64
	WhaleAccountWindow time.Duration

	// EnabledChains restricts the listener to a subset of the registry.
	EnabledChains []uint64

	// Billing: VIP subscriptions are paid in USDT to a single receiving address.
	VIPPriceUSD    float64
	PaymentNetwork string // tron | bsc | ethereum | polygon | arbitrum
	PaymentAddress string
	InvoiceTTL     time.Duration
	VIPPlanDays    int
}

// AlertLimits are the size floors a transfer has to clear before it is worth
// publishing. The tiers follow the limits Whale Alert publishes for its own
// feed, at a tenth of the size: theirs only fire a handful of times a day,
// which is too rare to trade on. A transfer is "known" when at least one side
// carries a label (exchange, pool, fund); those are the informative ones, so
// they clear at half the size of a move between two anonymous wallets.
type AlertLimits struct {
	// Stablecoins move constantly between exchanges, so they need the most size.
	StableKnown   float64
	StableUnknown float64
	StableMint    float64
	// Major is the wrapped native asset of a chain (WETH, WBNB, WPOL).
	MajorKnown   float64
	MajorUnknown float64
	// Token covers every other tracked ERC-20.
	TokenKnown   float64
	TokenUnknown float64
}

// PaymentsEnabled reports whether a receiving address is configured.
func (c Config) PaymentsEnabled() bool { return c.PaymentAddress != "" }

// Load reads configuration from the environment, applying production defaults.
func Load() (Config, error) {
	c := Config{
		PostgresDSN: env("POSTGRES_DSN", "postgres://whaleradar:whaleradar@localhost:5432/whaleradar?sslmode=disable"),
		RedisURL:    env("REDIS_URL", "redis://localhost:6379/0"),
		MinUSD:      envFloat("MIN_USD", 50_000),
		AlertUSD:    envFloat("ALERT_USD", 100_000),
		FreeMinUSD:  envFloat("FREE_CHANNEL_MIN_USD", 50_000),
		Limits: AlertLimits{
			StableKnown:   envFloat("LIMIT_STABLE_KNOWN_USD", 10_000_000),
			StableUnknown: envFloat("LIMIT_STABLE_UNKNOWN_USD", 20_000_000),
			StableMint:    envFloat("LIMIT_STABLE_MINT_USD", 100_000_000),
			MajorKnown:    envFloat("LIMIT_MAJOR_KNOWN_USD", 5_000_000),
			MajorUnknown:  envFloat("LIMIT_MAJOR_UNKNOWN_USD", 10_000_000),
			TokenKnown:    envFloat("LIMIT_TOKEN_KNOWN_USD", 2_000_000),
			TokenUnknown:  envFloat("LIMIT_TOKEN_UNKNOWN_USD", 5_000_000),
		},
		APIAddr:        env("API_ADDR", ":8080"),
		ScorerInterval: envDuration("SCORER_INTERVAL", 5*time.Minute),
		DataRetention:  envDuration("DATA_RETENTION", 30*24*time.Hour),
		VIPPriceUSD:    envFloat("VIP_PRICE_USD", 9.99),

		WhaleAccountMinUSD: envFloat("WHALE_ACCOUNT_MIN_USD", 50_000_000),
		WhaleAccountWindow: envDuration("WHALE_ACCOUNT_WINDOW", 30*24*time.Hour),
		PaymentNetwork:     strings.ToLower(env("PAYMENT_NETWORK", "tron")),
		PaymentAddress:     env("PAYMENT_ADDRESS", ""),
		InvoiceTTL:         envDuration("INVOICE_TTL", 45*time.Minute),
		VIPPlanDays:        envInt("VIP_PLAN_DAYS", 30),
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

func envInt(key string, def int) int {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
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
