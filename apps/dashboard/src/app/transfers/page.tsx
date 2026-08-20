'use client';

import { useState } from 'react';

import { Card, ChainBadge, DirectionBadge, EmptyState, Td, Th, TokenCell, UsdCell } from '@/components/ui';
import { usePoll } from '@/hooks/usePoll';
import { api, CHAINS, shortAddress, SIZE_FLOORS, timeAgo, usd } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

const DIRECTIONS = ['', 'cex_withdrawal', 'cex_deposit', 'dex_buy', 'dex_sell', 'wallet_transfer'];

export default function TransfersPage() {
  const { t } = useI18n();
  const [chainId, setChainId] = useState(0);
  const [direction, setDirection] = useState('');
  const [minUsd, setMinUsd] = useState(SIZE_FLOORS[1]);
  const [wallet, setWallet] = useState('');

  const query = `?chain_id=${chainId}&direction=${direction}&min_usd=${minUsd}&wallet=${wallet}&limit=100`;
  const transfers = usePoll(() => api.transfers(query), 10_000, [query]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t('transfers.title')}</h1>
        <p className="text-sm text-slate-400">{t('transfers.subtitle')}</p>
      </header>

      <Card className="flex flex-wrap items-end gap-4">
        <label className="text-xs text-slate-400">
          {t('common.chain')}
          <select
            value={chainId}
            onChange={(e) => setChainId(Number(e.target.value))}
            className="mt-1 block rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          >
            <option value={0}>{t('transfers.allChains')}</option>
            {Object.entries(CHAINS).map(([id, c]) => (
              <option key={id} value={id}>{c.name}</option>
            ))}
          </select>
        </label>

        <label className="text-xs text-slate-400">
          {t('common.direction')}
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
            className="mt-1 block rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          >
            {DIRECTIONS.map((d) => (
              <option key={d || 'all'} value={d}>{d ? d.replace(/_/g, ' ') : t('transfers.allDirections')}</option>
            ))}
          </select>
        </label>

        <label className="text-xs text-slate-400">
          {t('transfers.minUsd')}
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

        <label className="flex-1 text-xs text-slate-400">
          {t('transfers.wallet')}
          <input
            value={wallet}
            onChange={(e) => setWallet(e.target.value.trim())}
            placeholder="0x…"
            className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          />
        </label>
      </Card>

      <Card className="overflow-x-auto p-0">
        {transfers.data && transfers.data.length > 0 ? (
          <table className="w-full">
            <thead className="border-b border-slate-800">
              <tr>
                <Th>{t('common.time')}</Th>
                <Th>{t('common.chain')}</Th>
                <Th>{t('common.token')}</Th>
                <Th>{t('common.direction')}</Th>
                <Th>{t('common.amount')}</Th>
                <Th>{t('common.value')}</Th>
                <Th>{t('common.from')}</Th>
                <Th>{t('common.to')}</Th>
                <Th>{t('common.tx')}</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {transfers.data.map((row) => (
                <tr key={`${row.tx_hash}-${row.log_index}`} className="hover:bg-slate-900/60">
                  <Td>{timeAgo(row.seen_at)}</Td>
                  <Td><ChainBadge chainId={row.chain_id} /></Td>
                  <Td><TokenCell chainId={row.chain_id} token={row.token} symbol={row.token_symbol || shortAddress(row.token)} /></Td>
                  <Td><DirectionBadge direction={row.direction} /></Td>
                  <Td>{row.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })}</Td>
                  <Td><UsdCell value={row.amount_usd} /></Td>
                  <Td>{row.from_label || shortAddress(row.from)}</Td>
                  <Td>{row.to_label || shortAddress(row.to)}</Td>
                  <Td>
                    <a
                      className="text-sky-400 hover:underline"
                      href={`${CHAINS[row.chain_id]?.explorer ?? ''}/tx/${row.tx_hash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t('transfers.view')}
                    </a>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState message={transfers.loading ? t('transfers.loading') : t('transfers.empty')} />
        )}
      </Card>
    </div>
  );
}
