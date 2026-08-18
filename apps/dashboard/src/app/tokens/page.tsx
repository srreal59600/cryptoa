'use client';

import { useState } from 'react';

import { Card, ChainBadge, EmptyState, ScoreBar, Td, Th, UsdCell } from '@/components/ui';
import { usePoll } from '@/hooks/usePoll';
import { api, CHAINS, shortAddress, usd } from '@/lib/api';

export default function TokensPage() {
  const [chainId, setChainId] = useState(0);
  const query = `?chain_id=${chainId}&limit=100`;
  const scores = usePoll(() => api.scores(query), 30_000, [query]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Accumulation scores</h1>
          <p className="text-sm text-slate-400">
            0–100 score from 24h DEX net buying versus net exchange withdrawals, weighted by size and buyer breadth.
          </p>
        </div>
        <select
          value={chainId}
          onChange={(e) => setChainId(Number(e.target.value))}
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
        >
          <option value={0}>All chains</option>
          {Object.entries(CHAINS).map(([id, c]) => (
            <option key={id} value={id}>{c.name}</option>
          ))}
        </select>
      </header>

      <Card className="overflow-x-auto p-0">
        {scores.data && scores.data.length > 0 ? (
          <table className="w-full">
            <thead className="border-b border-slate-800">
              <tr>
                <Th>Token</Th>
                <Th>Score</Th>
                <Th>Regime</Th>
                <Th>DEX buys</Th>
                <Th>DEX sells</Th>
                <Th>CEX outflow</Th>
                <Th>CEX inflow</Th>
                <Th>Net</Th>
                <Th>Whale txs</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {scores.data.map((s) => (
                <tr key={`${s.chain_id}-${s.token}`} className="hover:bg-slate-900/60">
                  <Td>
                    <div className="flex items-center gap-2">
                      <ChainBadge chainId={s.chain_id} />
                      <span className="font-medium text-slate-100">{s.symbol || shortAddress(s.token)}</span>
                    </div>
                  </Td>
                  <Td><ScoreBar score={s.score} /></Td>
                  <Td>{s.label}</Td>
                  <Td>{usd(s.dex_buy_usd)}</Td>
                  <Td>{usd(s.dex_sell_usd)}</Td>
                  <Td>{usd(s.cex_outflow_usd)}</Td>
                  <Td>{usd(s.cex_inflow_usd)}</Td>
                  <Td><UsdCell value={s.net_accum_usd} /></Td>
                  <Td>{s.whale_tx_count}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState message={scores.loading ? 'Loading scores…' : 'The scorer publishes results every few minutes once transfers are recorded.'} />
        )}
      </Card>
    </div>
  );
}
