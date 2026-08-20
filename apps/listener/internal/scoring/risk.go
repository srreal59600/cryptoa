package scoring

// LiquidityImpactThreshold is the share of the token's observed 24h volume
// above which a single transfer is large enough to move the price hard.
const LiquidityImpactThreshold = 0.10

// WashReturnThreshold is the share of a transfer that has to come back from
// the counterparty for the flow to look like value cycling between wallets of
// the same owner rather than a real trade.
const WashReturnThreshold = 0.50

// WashLabel is the user-facing marker for artificial volume.
const WashLabel = "MANİPÜLASYON: YAPAY HACİM YARATMA"

// RiskInput is everything the risk filters need about one transfer.
type RiskInput struct {
	AmountUSD float64
	// Volume24hUSD is the token's observed traded volume in the last 24h. It
	// already includes this transfer.
	Volume24hUSD float64
	// ReturnedUSD is how much value flowed back from the receiver to the
	// sender on the same token inside the wash lookback window.
	ReturnedUSD float64
	// SelfTransfer is true when both sides are the same address or are
	// labelled as belonging to the same entity.
	SelfTransfer bool
}

// Risk is the outcome of the manipulation / volatility filters.
type Risk struct {
	// ImpactPct is the transfer as a share of 24h volume (0..1).
	ImpactPct float64
	// LiquidityWarning marks a transfer big enough relative to traded volume
	// that executing it could swing the price violently.
	LiquidityWarning bool
	// WashRisk marks flow that circulates back to its origin.
	WashRisk bool
	// WashReason explains why, so the alert never states manipulation without
	// showing the evidence behind it.
	WashReason string
}

// AssessRisk applies the liquidity-ratio and wash-trading filters. Both are
// risk signals, not verdicts: they say "this looks manipulable", never "the
// price will move".
func AssessRisk(in RiskInput) Risk {
	var r Risk
	if in.AmountUSD <= 0 {
		return r
	}

	// The denominator can never be smaller than the transfer itself; a token
	// with no other observed volume means this trade is the whole market.
	volume := in.Volume24hUSD
	if volume < in.AmountUSD {
		volume = in.AmountUSD
	}
	r.ImpactPct = in.AmountUSD / volume
	r.LiquidityWarning = r.ImpactPct > LiquidityImpactThreshold

	switch {
	case in.SelfTransfer:
		r.WashRisk = true
		r.WashReason = "same entity on both sides"
	case in.ReturnedUSD >= in.AmountUSD*WashReturnThreshold:
		r.WashRisk = true
		r.WashReason = "value cycled back to the sender"
	}
	return r
}
