'use client';

import { useEffect, useState } from 'react';

import { Card, EmptyState, Td, Th } from '@/components/ui';
import { api, BotUser, CHAINS, usd } from '@/lib/api';

const KEY_STORAGE = 'whaleradar.adminKey';

export default function AdminPage() {
  const [adminKey, setAdminKey] = useState('');
  const [users, setUsers] = useState<BotUser[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const [tagChain, setTagChain] = useState(1);
  const [tagAddress, setTagAddress] = useState('');
  const [tagLabel, setTagLabel] = useState('');
  const [tagCategory, setTagCategory] = useState('cex');

  useEffect(() => {
    const stored = window.localStorage.getItem(KEY_STORAGE);
    if (stored) setAdminKey(stored);
  }, []);

  const loadUsers = async (key: string) => {
    try {
      setUsers(await api.adminUsers(key));
      setStatus(null);
      window.localStorage.setItem(KEY_STORAGE, key);
    } catch (err) {
      setUsers(null);
      setStatus(err instanceof Error ? err.message : 'request failed');
    }
  };

  const grant = async (telegramId: number, tier: string, days: number) => {
    try {
      await api.setTier(adminKey, telegramId, tier, days);
      setStatus(`Updated ${telegramId} → ${tier}`);
      await loadUsers(adminKey);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'update failed');
    }
  };

  const saveTag = async () => {
    try {
      await api.saveTag(adminKey, tagChain, tagAddress, tagLabel, tagCategory);
      setStatus(`Saved label for ${tagAddress}`);
      setTagAddress('');
      setTagLabel('');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'save failed');
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="text-sm text-slate-400">Manage VIP subscriptions and wallet labelling. Requires the API admin key.</p>
      </header>

      <Card className="flex flex-wrap items-end gap-3">
        <label className="flex-1 text-xs text-slate-400">
          Admin API key
          <input
            type="password"
            value={adminKey}
            onChange={(e) => setAdminKey(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
            placeholder="ADMIN_API_KEY"
          />
        </label>
        <button
          onClick={() => void loadUsers(adminKey)}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500"
        >
          Load subscribers
        </button>
      </Card>

      {status ? <Card className="text-sm text-amber-300">{status}</Card> : null}

      <Card className="overflow-x-auto p-0">
        <div className="border-b border-slate-800 px-5 py-4">
          <h2 className="font-semibold">Telegram subscribers</h2>
        </div>
        {users && users.length > 0 ? (
          <table className="w-full">
            <thead className="border-b border-slate-800">
              <tr>
                <Th>Telegram ID</Th>
                <Th>Username</Th>
                <Th>Tier</Th>
                <Th>VIP expires</Th>
                <Th>DM threshold</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {users.map((u) => (
                <tr key={u.telegram_id}>
                  <Td>{u.telegram_id}</Td>
                  <Td>{u.username ? `@${u.username}` : '—'}</Td>
                  <Td>
                    <span className={u.tier === 'vip' ? 'text-emerald-300' : 'text-slate-400'}>{u.tier.toUpperCase()}</span>
                  </Td>
                  <Td>{u.vip_expires_at ? new Date(u.vip_expires_at).toISOString().slice(0, 10) : '—'}</Td>
                  <Td>{usd(u.min_usd)}</Td>
                  <Td className="space-x-2">
                    <button onClick={() => void grant(u.telegram_id, 'vip', 30)} className="rounded bg-emerald-600/80 px-2 py-1 text-xs">
                      +30d VIP
                    </button>
                    <button onClick={() => void grant(u.telegram_id, 'free', 0)} className="rounded bg-rose-600/80 px-2 py-1 text-xs">
                      Revoke
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState message="Enter the admin key and load subscribers." />
        )}
      </Card>

      <Card className="space-y-4">
        <h2 className="font-semibold">Wallet labelling</h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="text-xs text-slate-400">
            Chain
            <select
              value={tagChain}
              onChange={(e) => setTagChain(Number(e.target.value))}
              className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
            >
              <option value={0}>All chains</option>
              {Object.entries(CHAINS).map(([id, c]) => (
                <option key={id} value={id}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-400 sm:col-span-1">
            Address
            <input
              value={tagAddress}
              onChange={(e) => setTagAddress(e.target.value.trim())}
              placeholder="0x…"
              className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs text-slate-400">
            Label
            <input
              value={tagLabel}
              onChange={(e) => setTagLabel(e.target.value)}
              placeholder="Binance 22"
              className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
            />
          </label>
          <label className="text-xs text-slate-400">
            Category
            <select
              value={tagCategory}
              onChange={(e) => setTagCategory(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
            >
              {['cex', 'market_maker', 'dex_pool', 'bridge', 'burn', 'unknown'].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
        <button
          onClick={() => void saveTag()}
          disabled={!adminKey || !tagAddress}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:opacity-40"
        >
          Save label
        </button>
      </Card>
    </div>
  );
}
