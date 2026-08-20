export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';
export const TELEGRAM_BOT = process.env.NEXT_PUBLIC_TELEGRAM_BOT ?? '';

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
  token: string;
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

export interface PerformanceHorizon {
  horizon: string;
  samples: number;
  win_rate: number;
  avg_return: number;
  best_return: number;
  worst_return: number;
}

export interface AlertOutcome {
  alert_id: string;
  chain_id: number;
  token: string;
  token_symbol: string;
  direction: string;
  tier: string;
  wallet: string;
  amount_usd: number;
  score: number;
  entry_price: number;
  ret_1h: number | null;
  ret_4h: number | null;
  ret_24h: number | null;
  created_at: string;
}

export interface SmartWallet {
  chain_id: number;
  address: string;
  trades: number;
  wins: number;
  avg_ret_24h: number;
  best_ret: number;
  volume_usd: number;
  score: number;
  label: string;
}

export interface WhaleAccount {
  chain_id: number;
  address: string;
  label: string;
  volume_usd: number;
  inflow_usd: number;
  outflow_usd: number;
  tx_count: number;
  tokens: number;
  pnl_usd: number;
  pnl_pct: number;
  last_seen: string | null;
}

export interface WatchItem {
  chain_id: number;
  kind: string;
  address: string;
  label: string;
  created_at: string;
}

export interface Me {
  authenticated: boolean;
  vip: boolean;
  telegram_id?: number;
  username?: string;
  tier?: string;
  vip_expires_at?: string | null;
}

export interface Plan {
  price_usd: number;
  days: number;
  network: string;
  asset: string;
  enabled: boolean;
}

export interface Invoice {
  id: number;
  plan: string;
  days: number;
  amount_usdt: number;
  network: string;
  pay_to: string;
  status: string;
  tx_hash: string | null;
  created_at: string;
  expires_at: string;
  paid_at: string | null;
}

export interface TelegramAuth {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
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

export interface FlowBucket {
  bucket: string;
  volume_usd: number;
  outflow_usd: number;
  inflow_usd: number;
  count: number;
}

export interface TokenVolume {
  symbol: string;
  volume_usd: number;
  outflow_usd: number;
  inflow_usd: number;
  count: number;
}

export interface ChainVolume {
  chain_id: number;
  volume_usd: number;
  count: number;
}

export interface ExchangeFlow {
  label: string;
  volume_usd: number;
  inflow_usd: number;
  outflow_usd: number;
  net_usd: number;
  count: number;
}

export interface TopWallet {
  address: string;
  label: string;
  volume_usd: number;
  inflow_usd: number;
  outflow_usd: number;
  net_usd: number;
  count: number;
}

export interface HourHeatmap {
  hour: number;
  volume_usd: number;
  count: number;
}

export interface DirectionBreakdown {
  direction: string;
  volume_usd: number;
  count: number;
}

export interface PeriodCompare {
  volume_usd: number;
  outflow_usd: number;
  inflow_usd: number;
  count: number;
}

export interface Analytics {
  hours: number;
  flow: FlowBucket[];
  tokens: TokenVolume[];
  chains: ChainVolume[];
  exchanges: ExchangeFlow[];
  top_wallets: TopWallet[];
  heatmap: HourHeatmap[];
  directions: DirectionBreakdown[];
  previous: PeriodCompare | null;
}

/** Thrown for 401/402 so pages can render the sign-in or paywall state. */
export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function get<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { cache: 'no-store', credentials: 'include', ...init });
  if (!res.ok) {
    let message = `${path} failed: ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // non-JSON error body
    }
    throw new ApiError(res.status, message);
  }
  return (await res.json()) as T;
}

// Size floors offered on the feed and transfer filters. The upper ones match
// the publish limits used by the listener, so the site can be read at the same
// whale scale as the channels.
export const SIZE_FLOORS = [50_000, 500_000, 2_000_000, 10_000_000, 50_000_000];

export const api = {
  stats: () => get<Stats>('/api/stats'),
  transfers: (query = '') => get<Transfer[]>(`/api/transfers${query}`),
  scores: (query = '') => get<Score[]>(`/api/scores${query}`),
  pools: (query = '') => get<Pool[]>(`/api/pools${query}`),
  alerts: (limit = 25, minUsd = 0) => get<Alert[]>(`/api/alerts?limit=${limit}&min_usd=${minUsd}`),
  analytics: (hours = 24, minUsd = 0) =>
    get<Analytics>(`/api/analytics?hours=${hours}&min_usd=${minUsd}`),
  performance: (days = 30) => get<PerformanceHorizon[]>(`/api/performance?days=${days}`),
  outcomes: (limit = 50) => get<AlertOutcome[]>(`/api/outcomes?limit=${limit}`),
  smartWallets: (limit = 25) => get<SmartWallet[]>(`/api/smart-wallets?limit=${limit}`),
  whales: (limit = 50) => get<WhaleAccount[]>(`/api/whales?limit=${limit}`),
  watchlist: () => get<WatchItem[]>('/api/watchlist'),
  addWatch: (address: string, label: string, chainId: number) =>
    get<{ status: string }>('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address, label, chain_id: chainId }),
    }),
  removeWatch: (address: string) =>
    get<{ removed: number }>(`/api/watchlist?address=${encodeURIComponent(address)}`, {
      method: 'DELETE',
    }),
  me: () => get<Me>('/api/me'),
  loginTelegram: (payload: TelegramAuth) =>
    get<{ status: string }>('/api/auth/telegram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  logout: () => get<{ status: string }>('/api/auth/logout', { method: 'POST' }),
  plan: () => get<Plan>('/api/billing/plan'),
  createInvoice: () => get<Invoice>('/api/billing/invoice', { method: 'POST' }),
  invoices: () => get<Invoice[]>('/api/billing/invoices'),
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
