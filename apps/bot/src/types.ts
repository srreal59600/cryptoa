export interface Alert {
  id: string;
  kind: 'whale_transfer' | 'new_pool' | 'accumulation';
  tier: 'vip' | 'free';
  chain_id: number;
  chain: string;
  explorer: string;
  tx_hash: string;
  token: string;
  token_symbol: string;
  from: string;
  to: string;
  from_label: string;
  to_label: string;
  direction: string;
  amount: number;
  amount_usd: number;
  price_usd: number;
  score: number;
  note: string;
  created_at: string;
  net_accum_24h_usd: number;
  buyers_24h: number;
  whale_tx_24h: number;
  verdict: string;
}

export interface BotUser {
  telegram_id: number;
  username: string | null;
  tier: 'free' | 'vip';
  vip_expires_at: Date | null;
  min_usd: number;
  chains: number[];
  muted: boolean;
}

export interface WatchItem {
  chain_id: number;
  kind: 'token' | 'wallet';
  address: string;
  label: string;
}
