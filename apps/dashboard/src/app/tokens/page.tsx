'use client';

import { useState } from 'react';

import { Card, ChainBadge, EmptyState, ScoreBar, Td, Th, TokenCell, UsdCell } from '@/components/ui';
import { usePoll } from '@/hooks/usePoll';
import { api, CHAINS, shortAddress, usd } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

export default function TokensPage() {
  const { t } = useI18n();
  const [chainId, setChainId] = useState(0);
  const query = `?chain_id=${chainId}&limit=100`;
  const scores = usePoll(() => api.scores(query), 30_000, [query]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t('tokens.title')}</h1>
          <p className="text-sm text-slate-400">{t('tokens.subtitle')}</p>
        </div>
        <select
          value={chainId}
          onChange={(e) => setChainId(Number(e.target.value))}
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
        >
          <option value={0}>{t('transfers.allChains')}</option>
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
                <Th>{t('common.token')}</Th>
                <Th>{t('common.score')}</Th>
                <Th>{t('common.regime')}</Th>
                <Th>{t('common.dexBuys')}</Th>
                <Th>{t('common.dexSells')}</Th>
                <Th>{t('common.cexOutflow')}</Th>
                <Th>{t('common.cexInflow')}</Th>
                <Th>{t('common.net')}</Th>
                <Th>{t('common.whaleTxs')}</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {scores.data.map((s) => (
                <tr key={`${s.chain_id}-${s.token}`} className="hover:bg-slate-900/60">
                  <Td>
                    <div className="flex items-center gap-2">
                      <ChainBadge chainId={s.chain_id} />
                      <TokenCell chainId={s.chain_id} token={s.token} symbol={s.symbol || shortAddress(s.token)} />
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
          <EmptyState message={scores.loading ? t('tokens.loading') : t('tokens.empty')} />
        )}
      </Card>
    </div>
  );
}
