package eth

import (
	"context"
	"log/slog"
	"math/big"
	"math/rand"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"
)

const (
	backoffMin      = time.Second
	backoffMax      = 60 * time.Second
	backfillMaxSpan = 2_000
)

// Subscriber keeps a websocket log subscription alive with exponential backoff
// and backfills the blocks missed while the connection was down.
type Subscriber struct {
	Name    string
	WSURL   string
	Caller  *Caller
	Logger  *slog.Logger
	Out     chan<- types.Log
	Filters func() ethereum.FilterQuery

	mu        sync.Mutex
	lastBlock uint64
	restart   chan struct{}
}

// NewSubscriber builds a subscriber for a single chain.
func NewSubscriber(name, wsURL string, caller *Caller, logger *slog.Logger, out chan<- types.Log, filters func() ethereum.FilterQuery) *Subscriber {
	return &Subscriber{
		Name:    name,
		WSURL:   wsURL,
		Caller:  caller,
		Logger:  logger,
		Out:     out,
		Filters: filters,
		restart: make(chan struct{}, 1),
	}
}

// Restart asks the subscriber to re-open its subscription, e.g. after the set
// of tracked token addresses changed.
func (s *Subscriber) Restart() {
	select {
	case s.restart <- struct{}{}:
	default:
	}
}

// Run blocks until ctx is cancelled, reconnecting forever on failure.
func (s *Subscriber) Run(ctx context.Context) {
	attempt := 0
	for {
		if ctx.Err() != nil {
			return
		}
		err := s.session(ctx)
		if ctx.Err() != nil {
			return
		}
		attempt++
		d := backoff(attempt)
		s.Logger.Warn("subscription dropped, reconnecting", "chain", s.Name, "attempt", attempt, "in", d, "err", err)
		select {
		case <-ctx.Done():
			return
		case <-time.After(d):
		}
	}
}

func (s *Subscriber) session(ctx context.Context) error {
	client, err := ethclient.DialContext(ctx, s.WSURL)
	if err != nil {
		return err
	}
	defer client.Close()

	logs := make(chan types.Log, 1024)
	query := s.Filters()
	sub, err := client.SubscribeFilterLogs(ctx, query, logs)
	if err != nil {
		return err
	}
	defer sub.Unsubscribe()

	s.Logger.Info("subscribed", "chain", s.Name, "addresses", len(query.Addresses), "topics", len(query.Topics))
	s.backfill(ctx, query)

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case err := <-sub.Err():
			return err
		case <-s.restart:
			s.Logger.Info("restarting subscription with updated filters", "chain", s.Name)
			return nil
		case l := <-logs:
			s.setLastBlock(l.BlockNumber)
			select {
			case s.Out <- l:
			case <-ctx.Done():
				return ctx.Err()
			}
		}
	}
}

// backfill replays logs emitted between the last processed block and head.
func (s *Subscriber) backfill(ctx context.Context, query ethereum.FilterQuery) {
	from := s.getLastBlock()
	if from == 0 || s.Caller == nil {
		return
	}
	head, err := s.Caller.Raw().BlockNumber(ctx)
	if err != nil || head <= from {
		return
	}
	for start := from + 1; start <= head; start += backfillMaxSpan {
		end := start + backfillMaxSpan - 1
		if end > head {
			end = head
		}
		q := query
		q.FromBlock = new(big.Int).SetUint64(start)
		q.ToBlock = new(big.Int).SetUint64(end)
		found, err := s.Caller.Raw().FilterLogs(ctx, q)
		if err != nil {
			s.Logger.Warn("backfill failed", "chain", s.Name, "from", start, "to", end, "err", err)
			return
		}
		s.Logger.Info("backfilled logs", "chain", s.Name, "from", start, "to", end, "count", len(found))
		for _, l := range found {
			select {
			case s.Out <- l:
			case <-ctx.Done():
				return
			}
		}
		s.setLastBlock(end)
	}
}

func (s *Subscriber) getLastBlock() uint64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.lastBlock
}

func (s *Subscriber) setLastBlock(n uint64) {
	s.mu.Lock()
	if n > s.lastBlock {
		s.lastBlock = n
	}
	s.mu.Unlock()
}

// backoff returns an exponentially increasing delay with full jitter.
func backoff(attempt int) time.Duration {
	d := backoffMin << min(attempt-1, 16)
	if d > backoffMax || d <= 0 {
		d = backoffMax
	}
	return time.Duration(float64(d) * (0.5 + rand.Float64()/2))
}

// Query is a small helper for building filter queries.
func Query(addresses []common.Address, topics []common.Hash) ethereum.FilterQuery {
	return ethereum.FilterQuery{Addresses: addresses, Topics: [][]common.Hash{topics}}
}
