'use client';

import { useState } from 'react';

import { Card, ChainBadge, DirectionBadge, EmptyState, ScoreBar, StatCard, Td, Th, TokenCell, UsdCell } from '@/components/ui';
import { usePoll } from '@/hooks/usePoll';
import { api, CHAINS, shortAddress, SIZE_FLOORS, timeAgo, usd } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

export default function OverviewPage() {
  const { t } = useI18n();
  // Whale hunting beats a busy tape, so the feed starts at a high floor.
  const [minUsd, setMinUsd] = useState(SIZE_FLOORS[1]);
  const stats = usePoll(() => api.stats(), 15_000);
  const alerts = usePoll(() => api.alerts(15, minUsd), 8_000, [minUsd]);
  const scores = usePoll(() => api.scores('?limit=8'), 30_000);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t('overview.title')}</h1>
        <p className="text-sm text-slate-400">{t('overview.subtitle')}</p>
      </header>

      {stats.error ? (
        <Card className="border-rose-800 bg-rose-950/40 text-sm text-rose-200">
          {t('overview.apiDown', {
            error: stats.error,
            url: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080',
          })}
        </Card>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t('overview.volume24h')}
          value={usd(stats.data?.volume_24h_usd ?? 0)}
          sub={t('overview.transfersSub', { count: stats.data?.transfers_24h ?? 0 })}
        />
        <StatCard
          label={t('overview.cexOut')}
          value={usd(stats.data?.cex_outflow_24h_usd ?? 0)}
          sub={t('overview.cexOutSub')}
        />
        <StatCard
          label={t('overview.cexIn')}
          value={usd(stats.data?.cex_inflow_24h_usd ?? 0)}
          sub={t('overview.cexInSub')}
        />
        <StatCard
          label={t('overview.newPools')}
          value={String(stats.data?.new_pools_24h ?? 0)}
          sub={t('overview.newPoolsSub', { count: stats.data?.tracked_tokens ?? 0 })}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2 p-0">
          <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
            <h2 className="font-semibold">{t('overview.liveFeed')}</h2>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-slate-500">
                {t('overview.minSize')}
                <select
                  value={minUsd}
                  onChange={(e) => setMinUsd(Number(e.target.value))}
                  className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
                >
                  {SIZE_FLOORS.map((floor) => (
                    <option key={floor} value={floor}>
                      {usd(floor)}+
                    </option>
                  ))}
                </select>
              </label>
              <span className="text-xs text-slate-500">{t('overview.autoRefresh')}</span>
            </div>
          </div>
          {alerts.data && alerts.data.length > 0 ? (
            <ul className="divide-y divide-slate-800">
              {alerts.data.map((alert) => (
                <li key={alert.id} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <ChainBadge chainId={alert.chain_id} />
                      <TokenCell chainId={alert.chain_id} token={alert.token} symbol={alert.token_symbol} />
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
            <EmptyState
              message={
                alerts.loading
                  ? t('overview.loadingAlerts')
                  : t('overview.noAlertsAbove', { size: usd(minUsd) })
              }
            />
          )}
        </Card>

        <Card className="p-0">
          <div className="border-b border-slate-800 px-5 py-4">
            <h2 className="font-semibold">{t('overview.topAccumulation')}</h2>
          </div>
          {scores.data && scores.data.length > 0 ? (
            <table className="w-full">
              <thead>
                <tr>
                  <Th>{t('common.token')}</Th>
                  <Th>{t('common.score')}</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {scores.data.map((s) => (
                  <tr key={`${s.chain_id}-${s.token}`}>
                    <Td>
                      <div className="flex items-center gap-2">
                        <ChainBadge chainId={s.chain_id} />
                        <TokenCell chainId={s.chain_id} token={s.token} symbol={s.symbol || shortAddress(s.token)} />
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
            <EmptyState message={scores.loading ? t('auth.loading') : t('overview.noScores')} />
          )}
        </Card>
      </section>

      <Card>
        <h2 className="font-semibold">{t('overview.networks')}</h2>
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
              <p className="text-xs text-slate-500">{t('overview.chainId', { id })}</p>
            </a>
          ))}
        </div>
      </Card>
    </div>
  );
}
