package scoring

import "github.com/whaleradar/listener/internal/store"

const (
	// walletReturnCap is the 24h average return that maxes out the return term.
	walletReturnCap = 0.15
	// walletConfidenceTrades is the trade count at which a track record is
	// considered fully sampled; below it the score is pulled back to neutral.
	walletConfidenceTrades = 8
)

// ScoreWallet turns a wallet's realised 24h forward returns into a 0-100
// "smart money" score. Two things matter: how much the tokens it bought moved,
// and how often it was right. Thin track records stay close to neutral (50) so
// a lucky pair of trades cannot mint a smart-money wallet.
func ScoreWallet(w store.WalletPerf) float64 {
	if w.Trades <= 0 {
		return 50
	}
	ret := 50 * (1 + clamp(w.AvgRet24h/walletReturnCap, -1, 1))

	winRate := float64(w.Wins) / float64(w.Trades)
	hit := 100 * clamp(winRate, 0, 1)

	raw := 0.65*ret + 0.35*hit
	confidence := clamp(float64(w.Trades)/walletConfidenceTrades, 0, 1)
	return round2(clamp(50+(raw-50)*confidence, 0, 100))
}

// WalletLabel describes a wallet score in words.
func WalletLabel(score float64) string {
	switch {
	case score >= 75:
		return "Smart money"
	case score >= 60:
		return "Above average"
	case score > 40:
		return "Average"
	default:
		return "Weak track record"
	}
}
