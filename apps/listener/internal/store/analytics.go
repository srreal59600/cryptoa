package store

import (
	"context"
	"time"
)

// FlowBucket is one time slice of whale volume, split by the direction the
// value moved: out of an exchange (buying pressure), into an exchange (selling
// pressure) and everything else.
type FlowBucket struct {
	Bucket     time.Time `json:"bucket"`
	VolumeUSD  float64   `json:"volume_usd"`
	OutflowUSD float64   `json:"outflow_usd"`
	InflowUSD  float64   `json:"inflow_usd"`
	Count      int64     `json:"count"`
}

// TokenVolume is the share one token holds of the whale volume in a window.
type TokenVolume struct {
	Symbol     string  `json:"symbol"`
	VolumeUSD  float64 `json:"volume_usd"`
	OutflowUSD float64 `json:"outflow_usd"`
	InflowUSD  float64 `json:"inflow_usd"`
	Count      int64   `json:"count"`
}

// ChainVolume is the share one chain holds of the whale volume in a window.
type ChainVolume struct {
	ChainID   uint64  `json:"chain_id"`
	VolumeUSD float64 `json:"volume_usd"`
	Count     int64   `json:"count"`
}

// ExchangeFlow shows which labelled exchange is on the receiving or sending end
// of whale money.  Inflow = money entering the exchange (potential sell pressure),
// Outflow = money leaving the exchange (potential buy pressure).
type ExchangeFlow struct {
	Label      string  `json:"label"`
	VolumeUSD  float64 `json:"volume_usd"`
	InflowUSD  float64 `json:"inflow_usd"`
	OutflowUSD float64 `json:"outflow_usd"`
	NetUSD     float64 `json:"net_usd"`
	Count      int64   `json:"count"`
}

// TopWallet ranks individual addresses by whale volume in the window.
type TopWallet struct {
	Address    string  `json:"address"`
	Label      string  `json:"label"`
	VolumeUSD  float64 `json:"volume_usd"`
	InflowUSD  float64 `json:"inflow_usd"`
	OutflowUSD float64 `json:"outflow_usd"`
	NetUSD     float64 `json:"net_usd"`
	Count      int64   `json:"count"`
}

// HourHeatmap tells which hours of the day see the most whale activity.
type HourHeatmap struct {
	Hour      int     `json:"hour"`
	VolumeUSD float64 `json:"volume_usd"`
	Count     int64   `json:"count"`
}

// DirectionBreakdown splits volume and count by interpreted direction.
type DirectionBreakdown struct {
	Direction string  `json:"direction"`
	VolumeUSD float64 `json:"volume_usd"`
	Count     int64   `json:"count"`
}

// PeriodCompare is the same aggregate for the previous equal-length window so the
// dashboard can show "+23% vs previous period".
type PeriodCompare struct {
	VolumeUSD  float64 `json:"volume_usd"`
	OutflowUSD float64 `json:"outflow_usd"`
	InflowUSD  float64 `json:"inflow_usd"`
	Count      int64   `json:"count"`
}

// Analytics is everything the charts on the dashboard need for one window.
type Analytics struct {
	Hours      int                  `json:"hours"`
	Flow       []FlowBucket         `json:"flow"`
	Tokens     []TokenVolume        `json:"tokens"`
	Chains     []ChainVolume        `json:"chains"`
	Exchanges  []ExchangeFlow       `json:"exchanges"`
	TopWallets []TopWallet          `json:"top_wallets"`
	Heatmap    []HourHeatmap        `json:"heatmap"`
	Directions []DirectionBreakdown `json:"directions"`
	Previous   *PeriodCompare       `json:"previous"`
}

// AnalyticsWindow aggregates whale flow over the last hours. Buckets are hourly
// up to two days and daily beyond that, so the chart keeps a readable width.
func (p *Postgres) AnalyticsWindow(ctx context.Context, hours int, chainID uint64, minUSD float64) (Analytics, error) {
	if hours <= 0 || hours > 2160 {
		hours = 24
	}
	bucket := "hour"
	if hours > 48 {
		bucket = "day"
	}
	out := Analytics{
		Hours:      hours,
		Flow:       []FlowBucket{},
		Tokens:     []TokenVolume{},
		Chains:     []ChainVolume{},
		Exchanges:  []ExchangeFlow{},
		TopWallets: []TopWallet{},
		Heatmap:    []HourHeatmap{},
		Directions: []DirectionBreakdown{},
	}
	secs := float64(hours) * time.Hour.Seconds()
	prevSecs := secs * 2

	rows, err := p.pool.Query(ctx, `
		SELECT date_trunc($4, seen_at) AS bucket,
		       COALESCE(SUM(amount_usd),0),
		       COALESCE(SUM(amount_usd) FILTER (WHERE direction IN ('cex_withdrawal','dex_buy')),0),
		       COALESCE(SUM(amount_usd) FILTER (WHERE direction IN ('cex_deposit','dex_sell')),0),
		       count(*)
		FROM transfers
		WHERE seen_at >= now() - make_interval(secs => $1)
		  AND ($2 = 0 OR chain_id = $2)
		  AND amount_usd >= $3
		GROUP BY 1 ORDER BY 1`, secs, int64(chainID), minUSD, bucket)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var b FlowBucket
		if err := rows.Scan(&b.Bucket, &b.VolumeUSD, &b.OutflowUSD, &b.InflowUSD, &b.Count); err != nil {
			return out, err
		}
		out.Flow = append(out.Flow, b)
	}
	if err := rows.Err(); err != nil {
		return out, err
	}

	tokenRows, err := p.pool.Query(ctx, `
		SELECT token_symbol,
		       COALESCE(SUM(amount_usd),0),
		       COALESCE(SUM(amount_usd) FILTER (WHERE direction IN ('cex_withdrawal','dex_buy')),0),
		       COALESCE(SUM(amount_usd) FILTER (WHERE direction IN ('cex_deposit','dex_sell')),0),
		       count(*)
		FROM transfers
		WHERE seen_at >= now() - make_interval(secs => $1)
		  AND ($2 = 0 OR chain_id = $2)
		  AND amount_usd >= $3
		GROUP BY 1 ORDER BY 2 DESC LIMIT 8`, secs, int64(chainID), minUSD)
	if err != nil {
		return out, err
	}
	defer tokenRows.Close()
	for tokenRows.Next() {
		var t TokenVolume
		if err := tokenRows.Scan(&t.Symbol, &t.VolumeUSD, &t.OutflowUSD, &t.InflowUSD, &t.Count); err != nil {
			return out, err
		}
		out.Tokens = append(out.Tokens, t)
	}
	if err := tokenRows.Err(); err != nil {
		return out, err
	}

	chainRows, err := p.pool.Query(ctx, `
		SELECT chain_id, COALESCE(SUM(amount_usd),0), count(*)
		FROM transfers
		WHERE seen_at >= now() - make_interval(secs => $1)
		  AND amount_usd >= $2
		GROUP BY 1 ORDER BY 2 DESC`, secs, minUSD)
	if err != nil {
		return out, err
	}
	defer chainRows.Close()
	for chainRows.Next() {
		var c ChainVolume
		var cid int64
		if err := chainRows.Scan(&cid, &c.VolumeUSD, &c.Count); err != nil {
			return out, err
		}
		c.ChainID = uint64(cid)
		out.Chains = append(out.Chains, c)
	}

	cexRows, err := p.pool.Query(ctx, `
		WITH sides AS (
		  SELECT from_label AS label, amount_usd, 'out' AS side
		  FROM transfers
		  WHERE seen_at >= now() - make_interval(secs => $1)
		    AND ($2 = 0 OR chain_id = $2)
		    AND amount_usd >= $3
		    AND direction = 'cex_withdrawal'
		    AND from_label <> ''
		  UNION ALL
		  SELECT to_label AS label, amount_usd, 'in' AS side
		  FROM transfers
		  WHERE seen_at >= now() - make_interval(secs => $1)
		    AND ($2 = 0 OR chain_id = $2)
		    AND amount_usd >= $3
		    AND direction = 'cex_deposit'
		    AND to_label <> ''
		)
		SELECT label,
		       COALESCE(SUM(amount_usd),0) AS volume,
		       COALESCE(SUM(CASE WHEN side = 'in' THEN amount_usd ELSE 0 END),0) AS inflow,
		       COALESCE(SUM(CASE WHEN side = 'out' THEN amount_usd ELSE 0 END),0) AS outflow,
		       count(*)
		FROM sides
		GROUP BY 1 ORDER BY 2 DESC LIMIT 10`, secs, int64(chainID), minUSD)
	if err != nil {
		return out, err
	}
	defer cexRows.Close()
	for cexRows.Next() {
		var e ExchangeFlow
		if err := cexRows.Scan(&e.Label, &e.VolumeUSD, &e.InflowUSD, &e.OutflowUSD, &e.Count); err != nil {
			return out, err
		}
		e.NetUSD = e.OutflowUSD - e.InflowUSD
		out.Exchanges = append(out.Exchanges, e)
	}

	walletRows, err := p.pool.Query(ctx, `
		SELECT address, label, volume, inflow, outflow, cnt FROM (
		  SELECT from_address AS address,
		         COALESCE(MAX(from_label), '') AS label,
		         COALESCE(SUM(amount_usd),0) AS volume,
		         COALESCE(SUM(CASE WHEN direction IN ('cex_deposit','dex_sell') THEN amount_usd ELSE 0 END),0) AS inflow,
		         COALESCE(SUM(CASE WHEN direction IN ('cex_withdrawal','dex_buy') THEN amount_usd ELSE 0 END),0) AS outflow,
		         count(*) AS cnt
		  FROM transfers
		  WHERE seen_at >= now() - make_interval(secs => $1)
		    AND ($2 = 0 OR chain_id = $2)
		    AND amount_usd >= $3
		  GROUP BY 1
		  UNION ALL
		  SELECT to_address AS address,
		         COALESCE(MAX(to_label), '') AS label,
		         COALESCE(SUM(amount_usd),0) AS volume,
		         COALESCE(SUM(CASE WHEN direction IN ('cex_deposit','dex_sell') THEN amount_usd ELSE 0 END),0) AS inflow,
		         COALESCE(SUM(CASE WHEN direction IN ('cex_withdrawal','dex_buy') THEN amount_usd ELSE 0 END),0) AS outflow,
		         count(*) AS cnt
		  FROM transfers
		  WHERE seen_at >= now() - make_interval(secs => $1)
		    AND ($2 = 0 OR chain_id = $2)
		    AND amount_usd >= $3
		  GROUP BY 1
		) x
		ORDER BY volume DESC LIMIT 10`, secs, int64(chainID), minUSD)
	if err != nil {
		return out, err
	}
	defer walletRows.Close()
	seen := make(map[string]bool)
	for walletRows.Next() {
		var w TopWallet
		var cnt int64
		if err := walletRows.Scan(&w.Address, &w.Label, &w.VolumeUSD, &w.InflowUSD, &w.OutflowUSD, &cnt); err != nil {
			return out, err
		}
		if seen[w.Address] {
			continue
		}
		seen[w.Address] = true
		w.Count = cnt
		w.NetUSD = w.OutflowUSD - w.InflowUSD
		out.TopWallets = append(out.TopWallets, w)
	}

	heatRows, err := p.pool.Query(ctx, `
		SELECT EXTRACT(hour FROM seen_at)::int,
		       COALESCE(SUM(amount_usd),0),
		       count(*)
		FROM transfers
		WHERE seen_at >= now() - make_interval(secs => $1)
		  AND ($2 = 0 OR chain_id = $2)
		  AND amount_usd >= $3
		GROUP BY 1 ORDER BY 1`, secs, int64(chainID), minUSD)
	if err != nil {
		return out, err
	}
	defer heatRows.Close()
	for heatRows.Next() {
		var h HourHeatmap
		if err := heatRows.Scan(&h.Hour, &h.VolumeUSD, &h.Count); err != nil {
			return out, err
		}
		out.Heatmap = append(out.Heatmap, h)
	}

	dirRows, err := p.pool.Query(ctx, `
		SELECT direction, COALESCE(SUM(amount_usd),0), count(*)
		FROM transfers
		WHERE seen_at >= now() - make_interval(secs => $1)
		  AND ($2 = 0 OR chain_id = $2)
		  AND amount_usd >= $3
		GROUP BY 1 ORDER BY 2 DESC`, secs, int64(chainID), minUSD)
	if err != nil {
		return out, err
	}
	defer dirRows.Close()
	for dirRows.Next() {
		var d DirectionBreakdown
		if err := dirRows.Scan(&d.Direction, &d.VolumeUSD, &d.Count); err != nil {
			return out, err
		}
		out.Directions = append(out.Directions, d)
	}

	var prev PeriodCompare
	if err := p.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_usd),0),
		       COALESCE(SUM(amount_usd) FILTER (WHERE direction IN ('cex_withdrawal','dex_buy')),0),
		       COALESCE(SUM(amount_usd) FILTER (WHERE direction IN ('cex_deposit','dex_sell')),0),
		       count(*)
		FROM transfers
		WHERE seen_at >= now() - make_interval(secs => $1)
		  AND seen_at < now() - make_interval(secs => $2)
		  AND ($3 = 0 OR chain_id = $3)
		  AND amount_usd >= $4`, prevSecs, secs, int64(chainID), minUSD).Scan(
		&prev.VolumeUSD, &prev.OutflowUSD, &prev.InflowUSD, &prev.Count); err == nil {
		out.Previous = &prev
	}

	return out, chainRows.Err()
}
