'use client';

import { useCallback, useEffect, useState } from 'react';

import { VipGate, useAuth } from '@/components/auth';
import { Card, ChainBadge, EmptyState, Td, Th } from '@/components/ui';
import { usePoll } from '@/hooks/usePoll';
import { api, shortAddress, usd, type WatchItem } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

function pct(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(1)}%`;
}

function PnlCell({ value, ratio }: { value: number; ratio: number }) {
  const tone = value > 0 ? 'text-emerald-300' : value < 0 ? 'text-rose-300' : 'text-slate-300';
  return (
    <span className={`tabular-nums font-medium ${tone}`}>
      {usd(value)} <span className="text-xs text-slate-500">({pct(ratio)})</span>
    </span>
  );
}

export default function WhalesPage() {
  const { t } = useI18n();
  const { me } = useAuth();
  const vip = Boolean(me?.vip);

  const whales = usePoll(() => (vip ? api.whales(50) : Promise.resolve([])), 60_000, [vip]);
  const [watch, setWatch] = useState<WatchItem[]>([]);
  const [alias, setAlias] = useState('');
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    if (!vip) return;
    try {
      setWatch(await api.watchlist());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [vip]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const follow = async (addr: string, label: string, chainId: number) => {
    setError('');
    try {
      await api.addWatch(addr, label, chainId);
      setAddress('');
      setAlias('');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const unfollow = async (addr: string) => {
    try {
      await api.removeWatch(addr);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const followed = new Set(watch.map((w) => w.address.toLowerCase()));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t('whales.title')}</h1>
        <p className="text-sm text-slate-400">{t('whales.subtitle')}</p>
      </header>

      <VipGate>
        <Card className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
            {t('whales.watchlist')}
          </h2>

          <div className="flex flex-wrap gap-2">
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={t('whales.address')}
              className="min-w-64 flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs"
            />
            <input
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder={t('whales.aliasPlaceholder')}
              className="w-48 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
            />
            <button
              onClick={() => void follow(address.trim(), alias.trim(), 1)}
              disabled={!address.trim().startsWith('0x')}
              className="rounded-md bg-emerald-500/20 px-3 py-2 text-sm text-emerald-200 transition hover:bg-emerald-500/30 disabled:opacity-40"
            >
              {t('whales.add')}
            </button>
          </div>

          {error && <p className="text-xs text-rose-300">{error}</p>}

          {watch.length === 0 ? (
            <p className="text-sm text-slate-500">{t('whales.watchEmpty')}</p>
          ) : (
            <ul className="divide-y divide-slate-800">
              {watch.map((w) => (
                <li key={`${w.chain_id}-${w.address}`} className="flex items-center gap-3 py-2 text-sm">
                  <ChainBadge chainId={w.chain_id} />
                  <span className="font-medium text-slate-100">{w.label || '—'}</span>
                  <span className="font-mono text-xs text-slate-400">{shortAddress(w.address)}</span>
                  <button
                    onClick={() => void unfollow(w.address)}
                    className="ml-auto text-xs text-slate-400 transition hover:text-rose-300"
                  >
                    {t('whales.remove')}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <p className="text-xs text-slate-500">{t('whales.dmNote')}</p>
        </Card>

        <Card className="overflow-x-auto p-0">
          {whales.data && whales.data.length > 0 ? (
            <table className="w-full">
              <thead className="border-b border-slate-800">
                <tr>
                  <Th>{t('whales.account')}</Th>
                  <Th>{t('whales.volume')}</Th>
                  <Th>{t('whales.flow')}</Th>
                  <Th>{t('whales.txs')}</Th>
                  <Th>{t('whales.tokens')}</Th>
                  <Th>{t('whales.pnl')}</Th>
                  <Th> </Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {whales.data.map((a) => (
                  <tr key={`${a.chain_id}-${a.address}`} className="hover:bg-slate-900/60">
                    <Td>
                      <div className="flex items-center gap-2">
                        <ChainBadge chainId={a.chain_id} />
                        <span className="font-mono text-xs">{shortAddress(a.address)}</span>
                        {a.label && <span className="text-xs text-slate-400">{a.label}</span>}
                      </div>
                    </Td>
                    <Td>{usd(a.volume_usd)}</Td>
                    <Td className="text-xs text-slate-400">
                      {usd(a.inflow_usd)} / {usd(a.outflow_usd)}
                    </Td>
                    <Td>{a.tx_count}</Td>
                    <Td>{a.tokens}</Td>
                    <Td>
                      <PnlCell value={a.pnl_usd} ratio={a.pnl_pct} />
                    </Td>
                    <Td>
                      {followed.has(a.address.toLowerCase()) ? (
                        <span className="text-xs text-emerald-300">{t('whales.following')}</span>
                      ) : (
                        <button
                          onClick={() => void follow(a.address, '', a.chain_id)}
                          className="text-xs text-sky-300 transition hover:text-sky-200"
                        >
                          {t('whales.follow')}
                        </button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState message={whales.loading ? t('whales.loading') : t('whales.empty')} />
          )}
        </Card>

        <p className="text-xs text-slate-500">{t('whales.pnlNote')}</p>
      </VipGate>
    </div>
  );
}
