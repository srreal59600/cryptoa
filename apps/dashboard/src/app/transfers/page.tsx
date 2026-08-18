'use client';

import { useState } from 'react';

import { Card, ChainBadge, DirectionBadge, EmptyState, Td, Th, UsdCell } from '@/components/ui';
import { usePoll } from '@/hooks/usePoll';
import { api, CHAINS, shortAddress, timeAgo } from '@/lib/api';

const DIRECTIONS = ['', 'cex_withdrawal', 'cex_deposit', 'dex_buy', 'dex_sell', 'wallet_transfer'];

export default function TransfersPage() {
  const [chainId, setChainId] = useState(0);
  const [direction, setDirection] = useState('');
  const [minUsd, setMinUsd] = useState(50_000);
  const [wallet, setWallet] = useState('');

  const query = `?chain_id=${chainId}&direction=${direction}&min_usd=${minUsd}&wallet=${wallet}&limit=100`;
  const transfers = usePoll(() => api.transfers(query), 10_000, [query]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Whale feed</h1>
        <p className="text-sm text-slate-400">Every priced transfer above the ingest floor, newest first.</p>
      </header>

      <Card className="flex flex-wrap items-end gap-4">
        <label className="text-xs text-slate-400">
          Chain
          <select
            value={chainId}
            onChange={(e) => setChainId(Number(e.target.value))}
            className="mt-1 block rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          >
            <option value={0}>All chains</option>
            {Object.entries(CHAINS).map(([id, c]) => (
              <option key={id} value={id}>{c.name}</option>
            ))}
          </select>
        </label>

        <label className="text-xs text-slate-400">
          Direction
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
            className="mt-1 block rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          >
            {DIRECTIONS.map((d) => (
              <option key={d || 'all'} value={d}>{d ? d.replace(/_/g, ' ') : 'All directions'}</option>
            ))}
          </select>
        </label>

        <label className="text-xs text-slate-400">
          Min USD
          <input
            type="number"
            min={50_000}
            step={50_000}
            value={minUsd}
            onChange={(e) => setMinUsd(Number(e.target.value))}
            className="mt-1 block w-32 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          />
        </label>

        <label className="flex-1 text-xs text-slate-400">
          Wallet or token
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
                <Th>Time</Th>
                <Th>Chain</Th>
                <Th>Token</Th>
                <Th>Direction</Th>
                <Th>Amount</Th>
                <Th>Value</Th>
                <Th>From</Th>
                <Th>To</Th>
                <Th>Tx</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {transfers.data.map((t) => (
                <tr key={`${t.tx_hash}-${t.log_index}`} className="hover:bg-slate-900/60">
                  <Td>{timeAgo(t.seen_at)}</Td>
                  <Td><ChainBadge chainId={t.chain_id} /></Td>
                  <Td className="font-medium text-slate-100">{t.token_symbol || shortAddress(t.token)}</Td>
                  <Td><DirectionBadge direction={t.direction} /></Td>
                  <Td>{t.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })}</Td>
                  <Td><UsdCell value={t.amount_usd} /></Td>
                  <Td>{t.from_label || shortAddress(t.from)}</Td>
                  <Td>{t.to_label || shortAddress(t.to)}</Td>
                  <Td>
                    <a
                      className="text-sky-400 hover:underline"
                      href={`${CHAINS[t.chain_id]?.explorer ?? ''}/tx/${t.tx_hash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      view
                    </a>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState message={transfers.loading ? 'Loading transfers…' : 'No transfers match these filters yet.'} />
        )}
      </Card>
    </div>
  );
}
