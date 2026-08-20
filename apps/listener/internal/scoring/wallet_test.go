package scoring

import (
	"testing"

	"github.com/whaleradar/listener/internal/store"
)

func TestScoreWallet(t *testing.T) {
	cases := []struct {
		name     string
		in       store.WalletPerf
		wantMin  float64
		wantMax  float64
		wantLbl  string
		skipLabl bool
	}{
		{
			name:    "consistent winner",
			in:      store.WalletPerf{Trades: 20, Wins: 17, AvgRet24h: 0.18},
			wantMin: 85, wantMax: 100, wantLbl: "Smart money",
		},
		{
			name:    "thin track record stays near neutral",
			in:      store.WalletPerf{Trades: 2, Wins: 2, AvgRet24h: 0.30},
			wantMin: 50, wantMax: 65, skipLabl: true,
		},
		{
			name:    "consistent loser",
			in:      store.WalletPerf{Trades: 15, Wins: 2, AvgRet24h: -0.20},
			wantMin: 0, wantMax: 15, wantLbl: "Weak track record",
		},
		{
			name:    "no history is neutral",
			in:      store.WalletPerf{},
			wantMin: 50, wantMax: 50, wantLbl: "Average",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ScoreWallet(tc.in)
			if got < tc.wantMin || got > tc.wantMax {
				t.Fatalf("score = %v, want within [%v,%v]", got, tc.wantMin, tc.wantMax)
			}
			if !tc.skipLabl {
				if lbl := WalletLabel(got); lbl != tc.wantLbl {
					t.Fatalf("label = %q, want %q", lbl, tc.wantLbl)
				}
			}
		})
	}
}
