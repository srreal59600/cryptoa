package scoring

import (
	"testing"
	"time"

	"github.com/whaleradar/listener/internal/store"
)

func TestComputeAccumulationIsBullish(t *testing.T) {
	got := Compute(store.ScoreInput{
		DexBuyUSD:     5_000_000,
		DexSellUSD:    500_000,
		CEXOutflowUSD: 3_000_000,
		CEXInflowUSD:  200_000,
		UniqueBuyers:  40,
	}, time.Now())

	if got.Score < 70 {
		t.Fatalf("expected strong accumulation score, got %.2f", got.Score)
	}
	if got.NetAccumUSD != 7_300_000 {
		t.Fatalf("unexpected net accumulation: %.2f", got.NetAccumUSD)
	}
}

func TestComputeDistributionIsBearish(t *testing.T) {
	got := Compute(store.ScoreInput{
		DexBuyUSD:    200_000,
		DexSellUSD:   4_000_000,
		CEXInflowUSD: 6_000_000,
		UniqueBuyers: 2,
	}, time.Now())

	if got.Score > 30 {
		t.Fatalf("expected distribution score, got %.2f", got.Score)
	}
}

func TestComputeStaysInRange(t *testing.T) {
	cases := []store.ScoreInput{
		{},
		{DexBuyUSD: 1e12, UniqueBuyers: 100000},
		{CEXInflowUSD: 1e12},
		{DexSellUSD: 1, DexBuyUSD: 1},
	}
	for i, c := range cases {
		s := Compute(c, time.Now()).Score
		if s < 0 || s > 100 {
			t.Fatalf("case %d: score out of range: %.2f", i, s)
		}
	}
}

func TestLabelBoundaries(t *testing.T) {
	if Label(90) != "Aggressive Accumulation" {
		t.Fatalf("unexpected label for 90: %s", Label(90))
	}
	if Label(50) != "Neutral" {
		t.Fatalf("unexpected label for 50: %s", Label(50))
	}
	if Label(5) != "Heavy Distribution" {
		t.Fatalf("unexpected label for 5: %s", Label(5))
	}
}
