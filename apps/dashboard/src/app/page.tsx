'use client';

import { Card, ChainBadge, DirectionBadge, EmptyState, ScoreBar, StatCard, Td, Th, UsdCell } from '@/components/ui';
import { usePoll } from '@/hooks/usePoll';
import { api, CHAINS, shortAddress, timeAgo, usd } from '@/lib/api';

export default function OverviewPage() {
  const stats = usePoll(() => api.stats(), 15_000);
  const alerts = usePoll(() => api.alerts(15), 8_000);
  const scores = usePoll(() => api.scores('?limit=8'), 30_000);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Overview</h1>
        <p className="text-sm text-slate-400">
          Live whale flow across Ethereum, BNB Chain, Polygon and Arbitrum. Transfers below $50,000 are discarded at
          ingest.
        </p>
      </header>

      {stats.error ? (
        <Card className="border-rose-800 bg-rose-950/40 text-sm text-rose-200">
          API unreachable: {stats.error}. Is the Go API running on {process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080'}?
        </Card>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="24h whale volume" value={usd(stats.data?.volume_24h_usd ?? 0)} sub={`${stats.data?.transfers_24h ?? 0} transfers`} />
        <StatCard label="24h CEX outflow" value={usd(stats.data?.cex_outflow_24h_usd ?? 0)} sub="supply leaving exchanges" />
        <StatCard label="24h CEX inflow" value={usd(stats.data?.cex_inflow_24h_usd ?? 0)} sub="potential sell pressure" />
        <StatCard label="New pools (24h)" value={String(stats.data?.new_pools_24h ?? 0)} sub={`${stats.data?.tracked_tokens ?? 0} tracked tokens`} />
      </section>

      <section className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2 p-0">
          <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
            <h2 className="font-semibold">Live alert feed</h2>
            <span className="text-xs text-slate-500">auto-refresh 8s</span>
          </div>
          {alerts.data && alerts.data.length > 0 ? (
            <ul className="divide-y divide-slate-800">
              {alerts.data.map((alert) => (
                <li key={alert.id} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <ChainBadge chainId={alert.chain_id} />
                      <span className="font-medium text-slate-100">{alert.token_symbol}</span>
                      <DirectionBadge direction={alert.direction || alert.kind} />
                    </div>
                    <p className="mt-1 truncate text-xs text-slate-500">
                      {alert.from_label || '—'} → {alert.to_label || '—'} · {alert.note}
                    </p>
                  </div>
                  <div className="text-right">
                    <UsdCell value={alert.amount_usd} />
                    <p className="text-xs text-slate-500">{timeAgo(alert.created_at)}</p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState message={alerts.loading ? 'Loading alerts…' : 'No alerts yet — the listener publishes here as whales move.'} />
          )}
        </Card>

        <Card className="p-0">
          <div className="border-b border-slate-800 px-5 py-4">
            <h2 className="font-semibold">Top accumulation</h2>
          </div>
          {scores.data && scores.data.length > 0 ? (
            <table className="w-full">
              <thead>
                <tr>
                  <Th>Token</Th>
                  <Th>Score</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {scores.data.map((s) => (
                  <tr key={`${s.chain_id}-${s.token}`}>
                    <Td>
                      <div className="flex items-center gap-2">
                        <ChainBadge chainId={s.chain_id} />
                        <span>{s.symbol || shortAddress(s.token)}</span>
                      </div>
                      <p className="text-xs text-slate-500">{usd(s.net_accum_usd)} net</p>
                    </Td>
                    <Td>
                      <ScoreBar score={s.score} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState message={scores.loading ? 'Loading…' : 'Scores appear once the scorer has 24h of data.'} />
          )}
        </Card>
      </section>

      <Card>
        <h2 className="font-semibold">Tracked networks</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Object.entries(CHAINS).map(([id, chain]) => (
            <a
              key={id}
              href={chain.explorer}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-slate-800 px-4 py-3 transition hover:border-slate-600"
            >
              <p className="font-medium">{chain.name}</p>
              <p className="text-xs text-slate-500">Chain ID {id}</p>
            </a>
          ))}
        </div>
      </Card>
    </div>
  );
}
