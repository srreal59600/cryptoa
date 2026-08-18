'use client';

import { Card, ChainBadge, EmptyState, Td, Th } from '@/components/ui';
import { usePoll } from '@/hooks/usePoll';
import { api, CHAINS, shortAddress, timeAgo } from '@/lib/api';

export default function PoolsPage() {
  const pools = usePoll(() => api.pools('?limit=100'), 20_000);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">New liquidity pools</h1>
        <p className="text-sm text-slate-400">
          Resolved from V2 <code>PairCreated</code> and V3 <code>PoolCreated</code> logs on every registered factory.
        </p>
      </header>

      <Card className="overflow-x-auto p-0">
        {pools.data && pools.data.length > 0 ? (
          <table className="w-full">
            <thead className="border-b border-slate-800">
              <tr>
                <Th>Created</Th>
                <Th>Chain</Th>
                <Th>DEX</Th>
                <Th>Pool</Th>
                <Th>Token 0</Th>
                <Th>Token 1</Th>
                <Th>Fee</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {pools.data.map((p) => (
                <tr key={`${p.chain_id}-${p.address}`} className="hover:bg-slate-900/60">
                  <Td>{timeAgo(p.created_at)}</Td>
                  <Td><ChainBadge chainId={p.chain_id} /></Td>
                  <Td>{p.dex} <span className="text-xs text-slate-500">{p.version}</span></Td>
                  <Td>
                    <a
                      className="text-sky-400 hover:underline"
                      href={`${CHAINS[p.chain_id]?.explorer ?? ''}/address/${p.address}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {shortAddress(p.address)}
                    </a>
                  </Td>
                  <Td>{shortAddress(p.token0)}</Td>
                  <Td>{shortAddress(p.token1)}</Td>
                  <Td>{p.fee_tier ? `${p.fee_tier / 10_000}%` : '—'}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState message={pools.loading ? 'Loading pools…' : 'No pools discovered yet.'} />
        )}
      </Card>
    </div>
  );
}
