package scoring

import "testing"

func TestAssessRiskLiquidityThreshold(t *testing.T) {
	cases := []struct {
		name    string
		in      RiskInput
		warning bool
		impact  float64
	}{
		{"below threshold", RiskInput{AmountUSD: 100_000, Volume24hUSD: 2_000_000}, false, 0.05},
		{"exactly at threshold", RiskInput{AmountUSD: 100_000, Volume24hUSD: 1_000_000}, false, 0.10},
		{"above threshold", RiskInput{AmountUSD: 300_000, Volume24hUSD: 1_000_000}, true, 0.30},
		{"no other volume", RiskInput{AmountUSD: 250_000, Volume24hUSD: 0}, true, 1},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := AssessRisk(c.in)
			if got.LiquidityWarning != c.warning {
				t.Fatalf("LiquidityWarning = %v, want %v", got.LiquidityWarning, c.warning)
			}
			if diff := got.ImpactPct - c.impact; diff > 1e-9 || diff < -1e-9 {
				t.Fatalf("ImpactPct = %v, want %v", got.ImpactPct, c.impact)
			}
		})
	}
}

func TestAssessRiskWash(t *testing.T) {
	if r := AssessRisk(RiskInput{AmountUSD: 500_000, Volume24hUSD: 50_000_000, ReturnedUSD: 400_000}); !r.WashRisk {
		t.Fatal("expected wash risk when most of the value cycles back")
	}
	if r := AssessRisk(RiskInput{AmountUSD: 500_000, Volume24hUSD: 50_000_000, ReturnedUSD: 100_000}); r.WashRisk {
		t.Fatal("a small return flow is normal two-way trading, not wash trading")
	}
	r := AssessRisk(RiskInput{AmountUSD: 500_000, Volume24hUSD: 50_000_000, SelfTransfer: true})
	if !r.WashRisk || r.WashReason == "" {
		t.Fatal("expected a flagged self transfer to carry a reason")
	}
}

func TestAssessRiskZeroAmount(t *testing.T) {
	if r := AssessRisk(RiskInput{}); r.LiquidityWarning || r.WashRisk || r.ImpactPct != 0 {
		t.Fatalf("empty input must not raise anything: %+v", r)
	}
}
