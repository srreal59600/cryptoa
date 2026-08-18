export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

export interface Stats {
  transfers_24h: number;
  volume_24h_usd: number;
  cex_outflow_24h_usd: number;
  cex_inflow_24h_usd: number;
  new_pools_24h: number;
  tracked_tokens: number;
  largest_trade_24h_usd: number;
}

export interface Transfer {
  chain_id: number;
  tx_hash: string;
  log_index: number;
  block_number: number;
  seen_at: string;
  token: string;
  token_symbol: string;
  from: string;
  to: string;
  from_label: string;
  to_label: string;
  amount: number;
  price_usd: number;
  amount_usd: number;
  direction: string;
}

export interface Score {
  chain_id: number;
  token: string;
  symbol: string;
  score: number;
  previous_score: number;
  dex_buy_usd: number;
  dex_sell_usd: number;
  cex_inflow_usd: number;
  cex_outflow_usd: number;
  net_accum_usd: number;
  unique_buyers: number;
  whale_tx_count: number;
  computed_at: string;
  label: string;
}

export interface Pool {
  chain_id: number;
  address: string;
  dex: string;
  version: string;
  token0: string;
  token1: string;
  fee_tier: number;
  created_at: string;
}

export interface Alert {
  id: string;
  kind: string;
  tier: string;
  chain_id: number;
  chain: string;
  explorer: string;
  tx_hash: string;
  token_symbol: string;
  from_label: string;
  to_label: string;
  direction: string;
  amount: number;
  amount_usd: number;
  score: number;
  note: string;
  created_at: string;
}

export interface BotUser {
  telegram_id: number;
  username: string;
  tier: string;
  vip_expires_at: string | null;
  min_usd: number;
  muted: boolean;
  created_at: string;
}

async function get<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { cache: 'no-store', ...init });
  if (!res.ok) {
    throw new Error(`${path} failed: ${res.status}`);
  }
  return (await res.json()) as T;
}

export const api = {
  stats: () => get<Stats>('/api/stats'),
  transfers: (query = '') => get<Transfer[]>(`/api/transfers${query}`),
  scores: (query = '') => get<Score[]>(`/api/scores${query}`),
  pools: (query = '') => get<Pool[]>(`/api/pools${query}`),
  alerts: (limit = 25) => get<Alert[]>(`/api/alerts?limit=${limit}`),
  adminUsers: (key: string) =>
    get<BotUser[]>('/api/admin/users', { headers: { 'X-Admin-Key': key } }),
  setTier: (key: string, telegramId: number, tier: string, days: number) =>
    get<{ status: string }>('/api/admin/users/tier', {
      method: 'POST',
      headers: { 'X-Admin-Key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegram_id: telegramId, tier, days }),
    }),
  saveTag: (key: string, chainId: number, address: string, label: string, category: string) =>
    get<{ status: string }>('/api/admin/tags', {
      method: 'POST',
      headers: { 'X-Admin-Key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ chain_id: chainId, address, label, category }),
    }),
};

export const CHAINS: Record<number, { name: string; short: string; color: string; explorer: string }> = {
  1: { name: 'Ethereum', short: 'ETH', color: 'bg-indigo-500/15 text-indigo-300', explorer: 'https://etherscan.io' },
  56: { name: 'BNB Chain', short: 'BSC', color: 'bg-yellow-500/15 text-yellow-300', explorer: 'https://bscscan.com' },
  137: { name: 'Polygon', short: 'POL', color: 'bg-purple-500/15 text-purple-300', explorer: 'https://polygonscan.com' },
  42161: { name: 'Arbitrum', short: 'ARB', color: 'bg-sky-500/15 text-sky-300', explorer: 'https://arbiscan.io' },
};

export function usd(value: number): string {
  if (!Number.isFinite(value)) return '$0';
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

export function shortAddress(address: string): string {
  if (!address || address.length < 12) return address ?? '';
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${Math.floor(seconds)}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
