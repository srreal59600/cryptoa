package store

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/redis/go-redis/v9"

	"github.com/whaleradar/listener/internal/model"
)

// AlertChannel is the Redis pub/sub channel consumed by the Telegram bot.
const AlertChannel = "whaleradar:alerts"

// AlertStream is the capped Redis list backing the dashboard live feed.
const AlertStream = "whaleradar:alerts:recent"

// NewRedis parses a redis:// URL and returns a connected client.
func NewRedis(ctx context.Context, url string) (*redis.Client, error) {
	opt, err := redis.ParseURL(url)
	if err != nil {
		return nil, fmt.Errorf("parse redis url: %w", err)
	}
	c := redis.NewClient(opt)
	if err := c.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("ping redis: %w", err)
	}
	return c, nil
}

// PublishAlert fans an alert out to the bot and keeps the last 500 for the UI.
func PublishAlert(ctx context.Context, rdb *redis.Client, a model.Alert) error {
	payload, err := json.Marshal(a)
	if err != nil {
		return err
	}
	pipe := rdb.TxPipeline()
	pipe.Publish(ctx, AlertChannel, payload)
	pipe.LPush(ctx, AlertStream, payload)
	pipe.LTrim(ctx, AlertStream, 0, 499)
	_, err = pipe.Exec(ctx)
	return err
}

// RecentAlerts reads the newest alerts from the capped list, keeping only the
// ones worth at least minUSD so the feed shows whales instead of every move.
func RecentAlerts(ctx context.Context, rdb *redis.Client, limit int64, minUSD float64) ([]model.Alert, error) {
	// The whole capped list is scanned because the filter can reject most of it.
	raw, err := rdb.LRange(ctx, AlertStream, 0, -1).Result()
	if err != nil {
		return nil, err
	}
	out := make([]model.Alert, 0, limit)
	for _, r := range raw {
		if int64(len(out)) >= limit {
			break
		}
		var a model.Alert
		if err := json.Unmarshal([]byte(r), &a); err != nil {
			continue
		}
		if a.AmountUSD < minUSD {
			continue
		}
		out = append(out, a)
	}
	return out, nil
}
