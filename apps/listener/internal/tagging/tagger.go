package tagging

import (
	"context"
	"strings"
	"sync"

	"github.com/ethereum/go-ethereum/common"

	"github.com/whaleradar/listener/internal/model"
)

// Store loads persisted wallet tags (seeded by db/migrations and editable from
// the admin panel).
type Store interface {
	LoadWalletTags(ctx context.Context) ([]model.WalletTag, error)
}

// Tagger resolves address labels from the seed list, the database and pools
// discovered at runtime.
type Tagger struct {
	mu   sync.RWMutex
	tags map[uint64]map[common.Address]model.WalletTag
}

// New returns a tagger pre-populated with the built-in seed list.
func New() *Tagger {
	t := &Tagger{tags: map[uint64]map[common.Address]model.WalletTag{}}
	for _, tag := range Seed() {
		t.Put(tag)
	}
	return t
}

// LoadFrom merges persisted tags over the seed list.
func (t *Tagger) LoadFrom(ctx context.Context, s Store) error {
	tags, err := s.LoadWalletTags(ctx)
	if err != nil {
		return err
	}
	for _, tag := range tags {
		t.Put(tag)
	}
	return nil
}

// Put inserts or overwrites a tag.
func (t *Tagger) Put(tag model.WalletTag) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if _, ok := t.tags[tag.ChainID]; !ok {
		t.tags[tag.ChainID] = map[common.Address]model.WalletTag{}
	}
	t.tags[tag.ChainID][tag.Address] = tag
}

// PutPool registers a freshly discovered DEX pool as a tagged address.
func (t *Tagger) PutPool(chainID uint64, pool common.Address, dex string) {
	t.Put(model.WalletTag{ChainID: chainID, Address: pool, Label: dex + " Pool", Category: model.CategoryDexPool})
}

// Lookup returns the tag for an address, if any. Tags registered for chain 0
// are treated as cross-chain.
func (t *Tagger) Lookup(chainID uint64, a common.Address) (model.WalletTag, bool) {
	t.mu.RLock()
	defer t.mu.RUnlock()
	if m, ok := t.tags[chainID]; ok {
		if tag, ok := m[a]; ok {
			return tag, true
		}
	}
	if m, ok := t.tags[0]; ok {
		if tag, ok := m[a]; ok {
			tag.ChainID = chainID
			return tag, true
		}
	}
	if a == (common.Address{}) {
		return model.WalletTag{ChainID: chainID, Address: a, Label: "Zero Address", Category: model.CategoryBurn}, true
	}
	return model.WalletTag{}, false
}

// Classify derives the money-flow direction of a transfer from its endpoints.
func (t *Tagger) Classify(chainID uint64, from, to common.Address) (model.Direction, *model.WalletTag, *model.WalletTag) {
	fromTag, fromOK := t.Lookup(chainID, from)
	toTag, toOK := t.Lookup(chainID, to)

	var fp, tp *model.WalletTag
	if fromOK {
		f := fromTag
		fp = &f
	}
	if toOK {
		v := toTag
		tp = &v
	}

	switch {
	case from == (common.Address{}):
		return model.DirMint, fp, tp
	case toOK && toTag.Category == model.CategoryBurn:
		return model.DirBurn, fp, tp
	case toOK && isExchange(toTag.Category):
		return model.DirCEXDeposit, fp, tp
	case fromOK && isExchange(fromTag.Category):
		return model.DirCEXWithdrawal, fp, tp
	case fromOK && fromTag.Category == model.CategoryDexPool:
		return model.DirDexBuy, fp, tp
	case toOK && toTag.Category == model.CategoryDexPool:
		return model.DirDexSell, fp, tp
	default:
		return model.DirWallet, fp, tp
	}
}

func isExchange(c model.WalletCategory) bool {
	return c == model.CategoryCEX || c == model.CategoryMarketMaker
}

// Short renders an address as 0xabcd…1234 for alert bodies.
func Short(a common.Address) string {
	h := a.Hex()
	if len(h) < 12 {
		return h
	}
	return h[:6] + "…" + h[len(h)-4:]
}

// LabelOr returns the tag label or a shortened address.
func LabelOr(tag *model.WalletTag, a common.Address) string {
	if tag != nil && strings.TrimSpace(tag.Label) != "" {
		return tag.Label
	}
	return Short(a)
}
