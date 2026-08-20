'use client';

import { useState, type ReactNode } from 'react';

import { CHAINS, usd } from '@/lib/api';

// Trust Wallet publishes a logo per contract address, keyed by its own chain
// folder names.
const LOGO_CHAIN: Record<number, string> = {
  1: 'ethereum',
  56: 'smartchain',
  137: 'polygon',
  42161: 'arbitrum',
};

function logoURL(chainId: number, token: string) {
  const chain = LOGO_CHAIN[chainId];
  if (!chain || !/^0x[0-9a-fA-F]{40}$/.test(token)) return '';
  return `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${chain}/assets/${token}/logo.png`;
}

// TokenIcon shows the coin logo and falls back to its initial when the asset
// has no published icon, so rows never jump around.
export function TokenIcon({
  chainId,
  token,
  symbol,
  size = 20,
}: {
  chainId: number;
  token: string;
  symbol: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const url = logoURL(chainId, token);
  const box = { width: size, height: size };

  if (!url || failed) {
    return (
      <span
        style={box}
        className="inline-flex shrink-0 items-center justify-center rounded-full bg-slate-700 text-[10px] font-semibold text-slate-200"
      >
        {symbol.slice(0, 2).toUpperCase()}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={symbol}
      style={box}
      onError={() => setFailed(true)}
      className="shrink-0 rounded-full bg-slate-800"
    />
  );
}

// TokenCell pairs the logo with the symbol for use inside tables and feeds.
export function TokenCell({ chainId, token, symbol }: { chainId: number; token: string; symbol: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <TokenIcon chainId={chainId} token={token} symbol={symbol} />
      <span className="font-medium text-slate-100">{symbol}</span>
    </span>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-slate-800 bg-slate-900/60 p-5 shadow-lg shadow-black/20 ${className}`}>
      {children}
    </div>
  );
}

export function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <p className="text-xs uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-slate-50">{value}</p>
      {sub ? <p className="mt-1 text-xs text-slate-500">{sub}</p> : null}
    </Card>
  );
}

export function ChainBadge({ chainId }: { chainId: number }) {
  const chain = CHAINS[chainId];
  return (
    <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${chain?.color ?? 'bg-slate-700 text-slate-300'}`}>
      {chain?.short ?? chainId}
    </span>
  );
}

const DIRECTION_STYLE: Record<string, string> = {
  cex_withdrawal: 'bg-emerald-500/15 text-emerald-300',
  dex_buy: 'bg-emerald-500/15 text-emerald-300',
  cex_deposit: 'bg-rose-500/15 text-rose-300',
  dex_sell: 'bg-rose-500/15 text-rose-300',
  mint: 'bg-sky-500/15 text-sky-300',
  burn: 'bg-orange-500/15 text-orange-300',
  wallet_transfer: 'bg-slate-700/60 text-slate-300',
};

export function DirectionBadge({ direction }: { direction: string }) {
  return (
    <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${DIRECTION_STYLE[direction] ?? 'bg-slate-700/60 text-slate-300'}`}>
      {direction.replace(/_/g, ' ')}
    </span>
  );
}

export function ScoreBar({ score }: { score: number }) {
  const color = score >= 70 ? 'bg-emerald-500' : score >= 45 ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-800">
        <div className={`h-full ${color}`} style={{ width: `${Math.min(100, Math.max(0, score))}%` }} />
      </div>
      <span className="text-sm tabular-nums text-slate-200">{score.toFixed(1)}</span>
    </div>
  );
}

export function UsdCell({ value }: { value: number }) {
  const tone = value >= 1_000_000 ? 'text-emerald-300' : 'text-slate-200';
  return <span className={`tabular-nums font-medium ${tone}`}>{usd(value)}</span>;
}

export function Th({ children }: { children: ReactNode }) {
  return <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-400">{children}</th>;
}

export function Td({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <td className={`whitespace-nowrap px-4 py-3 text-sm text-slate-300 ${className}`}>{children}</td>;
}

export function EmptyState({ message }: { message: string }) {
  return <p className="px-4 py-10 text-center text-sm text-slate-500">{message}</p>;
}
