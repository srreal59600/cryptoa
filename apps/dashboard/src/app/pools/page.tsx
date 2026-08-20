'use client';

import { Card, ChainBadge, EmptyState, Td, Th } from '@/components/ui';
import { usePoll } from '@/hooks/usePoll';
import { api, CHAINS, shortAddress, timeAgo } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

export default function PoolsPage() {
  const { t } = useI18n();
  const pools = usePoll(() => api.pools('?limit=100'), 20_000);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{t('pools.title')}</h1>
        <p className="text-sm text-slate-400">{t('pools.subtitle')}</p>
      </header>

      <Card className="overflow-x-auto p-0">
        {pools.data && pools.data.length > 0 ? (
          <table className="w-full">
            <thead className="border-b border-slate-800">
              <tr>
                <Th>{t('common.created')}</Th>
                <Th>{t('common.chain')}</Th>
                <Th>{t('common.dex')}</Th>
                <Th>{t('common.pool')}</Th>
                <Th>{t('common.token0')}</Th>
                <Th>{t('common.token1')}</Th>
                <Th>{t('common.fee')}</Th>
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
          <EmptyState message={pools.loading ? t('pools.loading') : t('pools.empty')} />
        )}
      </Card>
    </div>
  );
}
