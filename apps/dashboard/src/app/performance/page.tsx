'use client';

import { VipGate, useAuth } from '@/components/auth';
import { Card, ChainBadge, DirectionBadge, EmptyState, ScoreBar, StatCard, Td, Th, TokenCell, UsdCell } from '@/components/ui';
import { usePoll } from '@/hooks/usePoll';
import { api, shortAddress, timeAgo, usd } from '@/lib/api';
import { useI18n, type Translate } from '@/lib/i18n';

function pct(value: number | null, signed = false): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const sign = signed && value > 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(1)}%`;
}

function ReturnCell({ value, t }: { value: number | null; t: Translate }) {
  if (value === null) return <span className="text-slate-600">{t('perf.pending')}</span>;
  const tone = value > 0 ? 'text-emerald-300' : value < 0 ? 'text-rose-300' : 'text-slate-300';
  return <span className={`tabular-nums font-medium ${tone}`}>{pct(value, true)}</span>;
}

export default function PerformancePage() {
  const { t } = useI18n();
  const { me } = useAuth();
  const vip = Boolean(me?.vip);
  const performance = usePoll(() => api.performance(30), 60_000, []);
  // Premium tables are VIP-gated server side, so only request them when unlocked.
  const outcomes = usePoll(() => (vip ? api.outcomes(50) : Promise.resolve([])), 60_000, [vip]);
  const wallets = usePoll(() => (vip ? api.smartWallets(25) : Promise.resolve([])), 60_000, [vip]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t('perf.title')}</h1>
        <p className="text-sm text-slate-400">{t('perf.subtitle')}</p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        {(performance.data ?? []).map((h) => (
          <StatCard
            key={h.horizon}
            label={t('perf.horizon', { horizon: h.horizon })}
            value={t('perf.win', { pct: (h.win_rate * 100).toFixed(0) })}
            sub={t('perf.horizonSub', {
              samples: h.samples,
              avg: pct(h.avg_return, true),
              best: pct(h.best_return, true),
            })}
          />
        ))}
      </div>

      <VipGate>
      <Card className="overflow-x-auto p-0">
        <h2 className="px-4 pt-4 text-sm font-semibold uppercase tracking-wider text-slate-400">{t('perf.smartWallets')}</h2>
        {wallets.data && wallets.data.length > 0 ? (
          <table className="mt-2 w-full">
            <thead className="border-b border-slate-800">
              <tr>
                <Th>{t('common.wallet')}</Th>
                <Th>{t('common.score')}</Th>
                <Th>{t('common.rating')}</Th>
                <Th>{t('common.trades')}</Th>
                <Th>{t('common.winRate')}</Th>
                <Th>{t('common.avg24h')}</Th>
                <Th>{t('common.volume')}</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {wallets.data.map((w) => (
                <tr key={`${w.chain_id}-${w.address}`} className="hover:bg-slate-900/60">
                  <Td>
                    <div className="flex items-center gap-2">
                      <ChainBadge chainId={w.chain_id} />
                      <span className="font-mono text-xs">{shortAddress(w.address)}</span>
                    </div>
                  </Td>
                  <Td><ScoreBar score={w.score} /></Td>
                  <Td>{w.label}</Td>
                  <Td>{w.trades}</Td>
                  <Td>{((w.wins / Math.max(1, w.trades)) * 100).toFixed(0)}%</Td>
                  <Td><ReturnCell value={w.avg_ret_24h} t={t} /></Td>
                  <Td>{usd(w.volume_usd)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState message={wallets.loading ? t('perf.walletsLoading') : t('perf.walletsEmpty')} />
        )}
      </Card>

      <Card className="overflow-x-auto p-0">
        <h2 className="px-4 pt-4 text-sm font-semibold uppercase tracking-wider text-slate-400">{t('perf.trackedAlerts')}</h2>
        {outcomes.data && outcomes.data.length > 0 ? (
          <table className="mt-2 w-full">
            <thead className="border-b border-slate-800">
              <tr>
                <Th>{t('common.when')}</Th>
                <Th>{t('common.token')}</Th>
                <Th>{t('common.signal')}</Th>
                <Th>{t('common.size')}</Th>
                <Th>1h</Th>
                <Th>4h</Th>
                <Th>24h</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {outcomes.data.map((o) => (
                <tr key={o.alert_id} className="hover:bg-slate-900/60">
                  <Td>{timeAgo(o.created_at)}</Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      <ChainBadge chainId={o.chain_id} />
                      <TokenCell chainId={o.chain_id} token={o.token} symbol={o.token_symbol || shortAddress(o.token)} />
                    </div>
                  </Td>
                  <Td><DirectionBadge direction={o.direction} /></Td>
                  <Td><UsdCell value={o.amount_usd} /></Td>
                  <Td><ReturnCell value={o.ret_1h} t={t} /></Td>
                  <Td><ReturnCell value={o.ret_4h} t={t} /></Td>
                  <Td><ReturnCell value={o.ret_24h} t={t} /></Td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState message={outcomes.loading ? t('perf.alertsLoading') : t('perf.alertsEmpty')} />
        )}
      </Card>
      </VipGate>
    </div>
  );
}
