import type { Alert } from './types';

/** Escapes text for Telegram MarkdownV2. */
export function esc(input: string | number): string {
  return String(input).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, (m) => `\\${m}`);
}

export function usd(value: number): string {
  if (!Number.isFinite(value)) return '$0';
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(2)}`;
}

export function amount(value: number): string {
  if (!Number.isFinite(value)) return '0';
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return value.toFixed(4);
}

export function short(address: string): string {
  if (!address || address.length < 12) return address ?? '';
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

const CHAIN_EMOJI: Record<number, string> = {
  1: '⟠',
  56: '🟡',
  137: '🟣',
  42161: '🔵',
};

const DIRECTION_HEADLINE: Record<string, string> = {
  cex_withdrawal: '🟢 EXCHANGE OUTFLOW',
  cex_deposit: '🔴 EXCHANGE INFLOW',
  dex_buy: '🟢 DEX BUY',
  dex_sell: '🔴 DEX SELL',
  mint: '🆕 TOKEN MINT',
  burn: '🔥 TOKEN BURN',
  wallet_transfer: '🐋 WHALE TRANSFER',
};

function verdictBadge(score: number): string {
  if (score >= 80) return '\u{1F7E2}\u{1F7E2}';
  if (score >= 65) return '\u{1F7E2}';
  if (score >= 45) return '\u26AA';
  if (score >= 30) return '\u{1F534}';
  return '\u{1F534}\u{1F534}';
}

function signed(value: number): string {
  return `${value >= 0 ? '+' : '-'}${usd(Math.abs(value))}`;
}

/** Builds the 24h read on the token so the alert is actionable, not just news. */
function analysis(alert: Alert): string[] {
  if (!alert.verdict) return [];
  const lines = [
    `*24h read:* ${verdictBadge(alert.score)} ${esc(alert.verdict)} \\(${esc(alert.score.toFixed(0))}/100\\)`,
    `*24h net flow:* ${esc(signed(alert.net_accum_24h_usd))} · *whale tx:* ${esc(alert.whale_tx_24h)} · *alıcı:* ${esc(alert.buyers_24h)}`,
  ];
  return lines;
}

function sizeBadge(usdValue: number): string {
  if (usdValue >= 10_000_000) return '🐋🐋🐋';
  if (usdValue >= 1_000_000) return '🐋🐋';
  return '🐋';
}

/** Renders a whale transfer / accumulation alert as MarkdownV2. */
export function renderAlert(
  alert: Alert,
  opts: { dashboardUrl: string; tier: 'vip' | 'free'; vipMinUsd?: number },
): string {
  if (alert.kind === 'accumulation') {
    return [
      `📈 *ACCUMULATION SIGNAL* ${esc(alert.token_symbol || short(alert.token))}`,
      '',
      `*Chain:* ${CHAIN_EMOJI[alert.chain_id] ?? ''} ${esc(alert.chain)}`,
      `*Score:* ${esc(alert.score.toFixed(1))}/100 — _${esc(alert.note)}_`,
      `*24h Net Accumulation:* ${esc(usd(alert.amount_usd))}`,
      '',
      `[Token page](${alert.explorer}/token/${alert.token}) · [Dashboard](${opts.dashboardUrl}/tokens)`,
    ].join('\n');
  }

  const headline = DIRECTION_HEADLINE[alert.direction] ?? '🐋 WHALE TRANSFER';
  const symbol = alert.token_symbol || short(alert.token);
  const lines = [
    `${sizeBadge(alert.amount_usd)} *${esc(headline)}*`,
    '',
    `*Token:* ${esc(symbol)} ${CHAIN_EMOJI[alert.chain_id] ?? ''} ${esc(alert.chain)}`,
    `*Amount:* ${esc(amount(alert.amount))} ${esc(symbol)} \\(*${esc(usd(alert.amount_usd))}*\\)`,
    `*Price:* ${esc(`$${alert.price_usd.toPrecision(6)}`)}`,
    '',
    `*From:* ${esc(alert.from_label || short(alert.from))}`,
    `*To:* ${esc(alert.to_label || short(alert.to))}`,
  ];

  if (alert.note) lines.push('', `_${esc(alert.note)}_`);

  const context = analysis(alert);
  if (context.length > 0) lines.push('', ...context);

  lines.push(
    '',
    `[Transaction](${alert.explorer}/tx/${alert.tx_hash}) · [Token](${alert.explorer}/token/${alert.token}) · [Dashboard](${opts.dashboardUrl})`,
  );

  if (opts.tier === 'free') {
    const vipFloor = usd(opts.vipMinUsd ?? 100_000);
    lines.push('', esc(`🔓 Free feed. ${vipFloor}+ whale flow goes to the VIP channel.`));
  }
  return lines.join('\n');
}
