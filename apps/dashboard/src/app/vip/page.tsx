'use client';

import Link from 'next/link';
import { useState } from 'react';

import { useAuth } from '@/components/auth';
import { Card } from '@/components/ui';
import { usePoll } from '@/hooks/usePoll';
import { api, type Invoice } from '@/lib/api';
import { useI18n, type Translate } from '@/lib/i18n';

const NETWORK_LABEL: Record<string, string> = {
  tron: 'TRON (TRC-20)',
  trc20: 'TRON (TRC-20)',
  bsc: 'BNB Smart Chain (BEP-20)',
  bep20: 'BNB Smart Chain (BEP-20)',
  ethereum: 'Ethereum (ERC-20)',
  erc20: 'Ethereum (ERC-20)',
  polygon: 'Polygon',
  arbitrum: 'Arbitrum One',
};

const STATUS_STYLE: Record<string, string> = {
  pending: 'text-amber-300',
  paid: 'text-emerald-300',
  expired: 'text-slate-500',
};

export default function VipPage() {
  const { t } = useI18n();
  const { me, refresh } = useAuth();
  const plan = usePoll(() => api.plan(), 60_000);
  // Polling keeps the page in sync with the on-chain payment watcher.
  const invoices = usePoll(() => (me?.authenticated ? api.invoices() : Promise.resolve([])), 15_000, [
    me?.authenticated,
  ]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = invoices.data?.find((i) => i.status === 'pending') ?? null;

  async function startPayment() {
    setCreating(true);
    setError(null);
    try {
      await api.createInvoice();
      invoices.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('vip.invoiceFailed'));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card>
        <div className="flex items-baseline justify-between">
          <h1 className="text-xl font-semibold text-slate-100">{t('vip.title')}</h1>
          <p className="text-2xl font-semibold text-amber-300">
            ${(plan.data?.price_usd ?? 9.99).toFixed(2)}
            <span className="ml-1 text-sm font-normal text-slate-400">
              {t('vip.per', { days: plan.data?.days ?? 30 })}
            </span>
          </p>
        </div>
        <ul className="mt-4 space-y-1.5 text-sm text-slate-300">
          <li>• {t('vip.benefit1')}</li>
          <li>• {t('vip.benefit2')}</li>
          <li>• {t('vip.benefit3')}</li>
          <li>• {t('vip.benefit4')}</li>
        </ul>
        <p className="mt-4 text-xs text-slate-500">{t('vip.disclaimer')}</p>
        <p className="mt-1 text-xs text-slate-500">
          <Link href="/legal" className="underline hover:text-slate-300">
            {t('vip.terms')}
          </Link>
        </p>
      </Card>

      {!me?.authenticated ? (
        <Card>
          <p className="text-sm text-slate-300">{t('vip.loginFirst')}</p>
          <Link
            href="/login"
            className="mt-3 inline-block rounded-md bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-400"
          >
            {t('auth.telegramLogin')}
          </Link>
        </Card>
      ) : me.vip ? (
        <Card>
          <p className="text-sm text-emerald-300">
            {t('vip.active')}
            {me.vip_expires_at
              ? t('vip.activeUntil', { date: new Date(me.vip_expires_at).toLocaleString() })
              : ''}
            .
          </p>
          <button
            onClick={() => void startPayment()}
            disabled={creating || plan.data?.enabled === false}
            className="mt-3 rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
          >
            {t('vip.extend')}
          </button>
        </Card>
      ) : (
        <Card>
          {plan.data?.enabled === false ? (
            <p className="text-sm text-amber-300">{t('vip.notConfigured')}</p>
          ) : (
            <>
              <p className="text-sm text-slate-300">
                {t('vip.payIntro', {
                  network:
                    NETWORK_LABEL[plan.data?.network ?? 'tron'] ?? plan.data?.network ?? 'TRON (TRC-20)',
                })}
              </p>
              <button
                onClick={() => void startPayment()}
                disabled={creating}
                className="mt-3 rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-amber-400 disabled:opacity-50"
              >
                {creating ? t('vip.creating') : t('vip.startPayment')}
              </button>
            </>
          )}
          {error ? <p className="mt-3 text-sm text-rose-400">{error}</p> : null}
        </Card>
      )}

      {open ? <InvoiceCard invoice={open} onPaid={refresh} t={t} /> : null}

      {invoices.data && invoices.data.length > 0 ? (
        <Card>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">{t('vip.history')}</h2>
          <div className="mt-3 space-y-2 text-sm">
            {invoices.data.map((inv) => (
              <div key={inv.id} className="flex justify-between border-b border-slate-800 pb-2 last:border-0">
                <span className="text-slate-400">{new Date(inv.created_at).toLocaleString()}</span>
                <span className="tabular-nums text-slate-200">{inv.amount_usdt.toFixed(2)} USDT</span>
                <span className={STATUS_STYLE[inv.status] ?? 'text-slate-400'}>{inv.status}</span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function InvoiceCard({
  invoice,
  onPaid,
  t,
}: {
  invoice: Invoice;
  onPaid: () => Promise<void>;
  t: Translate;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  function copy(value: string, key: string) {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(key);
      void onPaid();
    });
  }

  return (
    <Card className="border-amber-500/40">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-amber-300">{t('vip.pending')}</h2>
      <p className="mt-3 text-sm text-slate-300">{t('vip.pendingBody')}</p>

      <dl className="mt-4 space-y-3 text-sm">
        <div>
          <dt className="text-xs uppercase tracking-wider text-slate-500">{t('vip.network')}</dt>
          <dd className="text-slate-100">{NETWORK_LABEL[invoice.network] ?? invoice.network}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-slate-500">{t('vip.amount')}</dt>
          <dd className="flex items-center gap-2">
            <span className="font-mono text-lg text-amber-300">{invoice.amount_usdt.toFixed(2)} USDT</span>
            <button onClick={() => copy(invoice.amount_usdt.toFixed(2), 'amount')} className="text-xs text-sky-400">
              {copied === 'amount' ? t('vip.copied') : t('vip.copy')}
            </button>
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-slate-500">{t('vip.address')}</dt>
          <dd className="flex items-center gap-2">
            <span className="break-all font-mono text-slate-100">{invoice.pay_to}</span>
            <button onClick={() => copy(invoice.pay_to, 'address')} className="text-xs text-sky-400">
              {copied === 'address' ? t('vip.copied') : t('vip.copy')}
            </button>
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wider text-slate-500">{t('vip.expires')}</dt>
          <dd className="text-slate-300">{new Date(invoice.expires_at).toLocaleString()}</dd>
        </div>
      </dl>

      <p className="mt-4 text-xs text-slate-500">{t('vip.pendingNote')}</p>
    </Card>
  );
}
