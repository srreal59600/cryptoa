package billing

import (
	"testing"
	"time"

	"github.com/whaleradar/listener/internal/store"
)

func TestMatch(t *testing.T) {
	created := time.Now().Add(-5 * time.Minute)
	invoices := []store.Invoice{
		{ID: 1, AmountUSDT: 9.99, CreatedAt: created},
		{ID: 2, AmountUSDT: 10.00, CreatedAt: created},
		{ID: 3, AmountUSDT: 10.01, CreatedAt: created},
	}
	now := time.Now()

	cases := []struct {
		name   string
		amount float64
		want   int64
		ok     bool
	}{
		{"exact", 10.00, 2, true},
		{"rounding down inside tolerance", 9.998, 2, true},
		{"rounded up by the sender", 10.005, 2, true},
		{"a cent short pays the smaller invoice", 9.99, 1, true},
		{"underpaid", 9.5, 0, false},
		{"unrelated large deposit", 500, 0, false},
		{"overpaid within the allowance", 10.9, 3, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			inv, ok := match(invoices, map[int64]struct{}{}, Payment{Amount: c.amount, Seen: now})
			if ok != c.ok {
				t.Fatalf("matched=%v, want %v", ok, c.ok)
			}
			if ok && inv.ID != c.want {
				t.Fatalf("invoice %d, want %d", inv.ID, c.want)
			}
		})
	}
}

func TestMatchSkipsAlreadySettledAndOlderPayments(t *testing.T) {
	created := time.Now()
	invoices := []store.Invoice{{ID: 1, AmountUSDT: 9.99, CreatedAt: created}}

	if _, ok := match(invoices, map[int64]struct{}{1: {}}, Payment{Amount: 9.99, Seen: created}); ok {
		t.Fatal("a settled invoice must not be credited twice")
	}
	old := Payment{Amount: 9.99, Seen: created.Add(-time.Hour)}
	if _, ok := match(invoices, map[int64]struct{}{}, old); ok {
		t.Fatal("a payment older than the invoice must not settle it")
	}
}
