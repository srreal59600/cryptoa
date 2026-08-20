'use client';

import { useState, useMemo } from 'react';

import { AreaChart, BarList, Donut, Heatmap } from '@/components/charts';
import { Card, EmptyState, StatCard } from '@/components/ui';
import { usePoll } from '@/hooks/usePoll';
import { api, CHAINS, SIZE_FLOORS, usd } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

const WINDOWS = [24, 168, 720];

const DIRECTION_META: Record<string, { label: string; color: string }> = {
  cex_withdrawal: { label: 'CEX withdrawal', color: '#34d399' },
  cex_deposit: { label: 'CEX deposit', color: '#fb7185' },
  dex_buy: { label: 'DEX buy', color: '#22d3ee' },
  dex_sell: { label: 'DEX sell', color: '#f472b6' },
  wallet_transfer: { label: 'Wallet transfer', color: '#94a3b8' },
  mint: { label: 'Mint', color: '#a78bfa' },
  burn: { label: 'Burn', color: '#fbbf24' },
};

function comparePct(now: number, prev: number): string {
  if (prev <= 0) return now > 0 ? 'new' : '-';
  const pct = ((now - prev) / prev) * 100;
  const sign = pct >= 0 ? '+' : '';
  return `${sign}${pct.toFixed(0)}%`;
}

export default function AnalyticsPage() {
  const { t, locale } = useI18n();
  const [hours, setHours] = useState(24);
  const [minUsd, setMinUsd] = useState(SIZE_FLOORS[0]);
  const data = usePoll(() => api.analytics(hours, minUsd), 30_000, [hours, minUsd]);

  const d = data.data;
  const flow = d?.flow ?? [];
  const labels = flow.map((b) =>
    new Date(b.bucket).toLocaleString(locale === 'tr' ? 'tr-TR' : 'en-US', {
      day: '2-digit',
      month: 'short',
      hour: hours <= 48 ? '2-digit' : undefined,
    }),
  );
  const totalVolume = flow.reduce((sum, b) => sum + b.volume_usd, 0);
  const totalOut = flow.reduce((sum, b) => sum + b.outflow_usd, 0);
  const totalIn = flow.reduce((sum, b) => sum + b.inflow_usd, 0);
  const net = totalOut - totalIn;

  const prev = d?.previous;
  const heatPoints = useMemo(
    () =>
      Array.from({ length: 24 }, (_, h) => {
        const found = d?.heatmap.find((x) => x.hour === h);
        return {
          label: `${h.toString().padStart(2, '0')}:00`,
          value: found?.volume_usd ?? 0,
          title: `${h}:00 — ${usd(found?.volume_usd ?? 0)} · ${found?.count ?? 0} tx`,
        };
      }),
    [d?.heatmap],
  );

  const directionSlices = useMemo(
    () =>
      (d?.directions ?? [])
        .map((dir) => {
          const meta = DIRECTION_META[dir.direction] ?? { label: dir.direction, color: '#94a3b8' };
          return { label: meta.label, value: dir.volume_usd, color: meta.color };
        })
        .sort((a, b) => b.value - a.value),
    [d?.directions],
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t('analytics.title')}</h1>
          <p className="text-sm text-slate-400">{t('analytics.subtitle')}</p>
        </div>
        <div className="flex gap-3">
          <label className="text-xs uppercase tracking-wider text-slate-400">
            {t('analytics.window')}
            <select
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
              className="mt-1 block rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
            >
              {WINDOWS.map((h) => (
                <option key={h} value={h}>
                  {h === 24 ? '24h' : `${h / 24}d`}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs uppercase tracking-wider text-slate-400">
            {t('overview.minSize')}
            <select
              value={minUsd}
              onChange={(e) => setMinUsd(Number(e.target.value))}
              className="mt-1 block rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
            >
              {SIZE_FLOORS.map((floor) => (
                <option key={floor} value={floor}>
                  {usd(floor)}+
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t('analytics.totalVolume')}
          value={usd(totalVolume)}
          sub={prev ? `${comparePct(totalVolume, prev.volume_usd)} ${t('analytics.compare', { hours })}` : undefined}
        />
        <StatCard
          label={t('overview.cexOut')}
          value={usd(totalOut)}
          sub={prev ? `${comparePct(totalOut, prev.outflow_usd)} ${t('analytics.compare', { hours })}` : undefined}
        />
        <StatCard
          label={t('overview.cexIn')}
          value={usd(totalIn)}
          sub={prev ? `${comparePct(totalIn, prev.inflow_usd)} ${t('analytics.compare', { hours })}` : undefined}
        />
        <StatCard
          label={t('analytics.net')}
          value={`${net >= 0 ? '+' : '−'}${usd(Math.abs(net))}`}
          sub={net >= 0 ? t('analytics.netBuy') : t('analytics.netSell')}
        />
      </div>

      <Card>
        <h2 className="text-sm font-semibold text-slate-200">{t('analytics.flowChart')}</h2>
        {flow.length > 0 ? (
          <div className="mt-4">
            <AreaChart
              labels={labels}
              series={[
                { label: t('analytics.buyPressure'), color: '#34d399', points: flow.map((b) => b.outflow_usd) },
                { label: t('analytics.sellPressure'), color: '#fb7185', points: flow.map((b) => b.inflow_usd) },
              ]}
            />
          </div>
        ) : (
          <EmptyState message={data.loading ? t('analytics.loading') : t('analytics.empty')} />
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="text-sm font-semibold text-slate-200">{t('analytics.topTokens')}</h2>
          <div className="mt-4">
            {d && d.tokens.length > 0 ? (
              <BarList
                bars={d.tokens.map((tok) => ({
                  label: tok.symbol,
                  value: tok.volume_usd,
                  sub: `${tok.count} tx · net ${usd(tok.outflow_usd - tok.inflow_usd)}`,
                }))}
              />
            ) : (
              <EmptyState message={data.loading ? t('analytics.loading') : t('analytics.empty')} />
            )}
          </div>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold text-slate-200">{t('analytics.byChain')}</h2>
          <div className="mt-4">
            {d && d.chains.length > 0 ? (
              <BarList
                color="#a78bfa"
                bars={d.chains.map((c) => ({
                  label: CHAINS[c.chain_id]?.name ?? `Chain ${c.chain_id}`,
                  value: c.volume_usd,
                  sub: `${c.count} tx`,
                }))}
              />
            ) : (
              <EmptyState message={data.loading ? t('analytics.loading') : t('analytics.empty')} />
            )}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="text-sm font-semibold text-slate-200">{t('analytics.exchanges')}</h2>
          <div className="mt-4">
            {d && d.exchanges.length > 0 ? (
              <BarList
                color="#34d399"
                bars={d.exchanges.map((e) => ({
                  label: e.label || 'Unknown CEX',
                  value: e.volume_usd,
                  sub: `out ${usd(e.outflow_usd)} / in ${usd(e.inflow_usd)} · ${e.count} tx`,
                  color: e.net_usd >= 0 ? '#34d399' : '#fb7185',
                }))}
              />
            ) : (
              <EmptyState message={data.loading ? t('analytics.loading') : t('analytics.empty')} />
            )}
          </div>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold text-slate-200">{t('analytics.topWallets')}</h2>
          <div className="mt-4">
            {d && d.top_wallets.length > 0 ? (
              <div className="space-y-3">
                {d.top_wallets.map((w) => (
                  <div key={w.address} className="rounded-lg border border-slate-800 p-3 text-sm">
                    <div className="flex items-baseline justify-between">
                      <span className="font-medium text-slate-200">{w.label || w.address.slice(0, 8)}</span>
                      <span className="tabular-nums text-slate-300">{usd(w.volume_usd)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-500">
                      <span>{w.address.slice(0, 10)}…{w.address.slice(-4)}</span>
                      <span>net {w.net_usd >= 0 ? '+' : ''}{usd(w.net_usd)}</span>
                      <span>{w.count} tx</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState message={data.loading ? t('analytics.loading') : t('analytics.empty')} />
            )}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="text-sm font-semibold text-slate-200">{t('analytics.heatmap')}</h2>
          <div className="mt-4">
            {d && d.heatmap.length > 0 ? (
              <Heatmap points={heatPoints} />
            ) : (
              <EmptyState message={data.loading ? t('analytics.loading') : t('analytics.empty')} />
            )}
          </div>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold text-slate-200">{t('analytics.directions')}</h2>
          <div className="mt-4">
            {directionSlices.length > 0 ? (
              <Donut slices={directionSlices} />
            ) : (
              <EmptyState message={data.loading ? t('analytics.loading') : t('analytics.empty')} />
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
