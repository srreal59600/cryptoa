package scoring

import (
	"math"
	"time"

	"github.com/whaleradar/listener/internal/model"
	"github.com/whaleradar/listener/internal/store"
)

// Weights control how the three sub-scores combine into the final 0-100 value.
const (
	flowWeight      = 0.60
	magnitudeWeight = 0.25
	breadthWeight   = 0.15

	// magnitudeCapUSD is the net accumulation that saturates the magnitude term.
	magnitudeCapUSD = 25_000_000
	// breadthCap is the unique-buyer count that saturates the breadth term.
	breadthCap = 50
)

// Compute turns a 24h aggregate into an accumulation score.
//
//	flow      : directional balance of DEX net buys and CEX net withdrawals
//	magnitude : log-scaled size of the net accumulated USD
//	breadth   : how many distinct wallets participated
func Compute(in store.ScoreInput, at time.Time) model.TokenScore {
	netDex := in.DexBuyUSD - in.DexSellUSD
	// A withdrawal moves supply off exchanges: bullish. A deposit is bearish.
	netCex := in.CEXOutflowUSD - in.CEXInflowUSD
	netAccum := netDex + netCex

	gross := in.DexBuyUSD + in.DexSellUSD + in.CEXInflowUSD + in.CEXOutflowUSD
	flow := 50.0
	if gross > 0 {
		flow = 50 * (1 + clamp(netAccum/gross, -1, 1))
	}

	magnitude := 50.0
	if netAccum != 0 {
		sign := 1.0
		if netAccum < 0 {
			sign = -1
		}
		norm := math.Log10(1+math.Abs(netAccum)) / math.Log10(1+magnitudeCapUSD)
		magnitude = 50 * (1 + sign*clamp(norm, 0, 1))
	}

	breadth := 50 * clamp(float64(in.UniqueBuyers)/breadthCap, 0, 2)

	score := clamp(flowWeight*flow+magnitudeWeight*magnitude+breadthWeight*breadth, 0, 100)

	return model.TokenScore{
		ChainID:        in.ChainID,
		Token:          in.Token,
		Symbol:         in.Symbol,
		Score:          round2(score),
		DexBuyUSD:      in.DexBuyUSD,
		DexSellUSD:     in.DexSellUSD,
		CEXInflowUSD:   in.CEXInflowUSD,
		CEXOutflowUSD:  in.CEXOutflowUSD,
		UniqueBuyers:   in.UniqueBuyers,
		WhaleTxCount:   in.WhaleTxCount,
		NetAccumUSD:    netAccum,
		LargestTradeUS: in.LargestTrade,
		ComputedAt:     at,
		PreviousScore:  in.PreviousScore,
		ScoreDelta24h:  round2(score - in.PreviousScore),
	}
}

// Label maps a score onto a human readable regime.
func Label(score float64) string {
	switch {
	case score >= 85:
		return "Aggressive Accumulation"
	case score >= 70:
		return "Accumulation"
	case score >= 55:
		return "Mild Accumulation"
	case score > 45:
		return "Neutral"
	case score > 30:
		return "Mild Distribution"
	case score > 15:
		return "Distribution"
	default:
		return "Heavy Distribution"
	}
}

func clamp(v, lo, hi float64) float64 {
	return math.Max(lo, math.Min(hi, v))
}

func round2(v float64) float64 { return math.Round(v*100) / 100 }
