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

/** Formats a ratio as a percentage, optionally signed. */
export function pct(value: number, signed = false): string {
  if (!Number.isFinite(value)) return '0%';
  const sign = signed && value > 0 ? '+' : '';
  return `${sign}${(value * 100).toFixed(1)}%`;
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

  if (alert.wallet_trades > 0) {
    lines.push(
      `*Alıcı cüzdan:* ${esc(alert.wallet_label)} ${esc(alert.wallet_score.toFixed(0))}/100 \\(${esc(alert.wallet_trades)} geçmiş alım\\)`,
    );
  }
  if (alert.smart_wallets_24h >= 2) {
    lines.push(`🧠 *Cluster:* ${esc(alert.smart_wallets_24h)} akıllı cüzdan son 24s bu tokeni topluyor`);
  }
  lines.push(...riskLines(alert));
  return lines;
}

/**
 * Manipulation filters. Both lines are warnings about how the flow could be
 * abused, never a prediction: a large share of thin volume can swing the price,
 * and value that returns to its sender inflates volume without changing hands.
 */
function riskLines(alert: Alert): string[] {
  const lines: string[] = [];
  if (alert.liquidity_warning) {
    lines.push(
      `⚠️ *Likidite oranı:* işlem 24s hacminin ${esc(pct(alert.impact_pct))} kadarı — fiyatı sert oynatabilir, yüksek volatilite riski`,
    );
  }
  if (alert.wash_risk) {
    lines.push(
      `🚨 *${esc('MANİPÜLASYON: YAPAY HACİM YARATMA')}* — ${esc(alert.wash_reason || 'değer aynı cüzdan grubunda dönüyor')}`,
    );
  }
  if (alert.whale_account) {
    lines.push(
      `🐋 *Takipteki büyük hesap* — 30g tahmini sonuç ${esc(signed(alert.pnl_30d_usd))} \\(${esc(pct(alert.pnl_30d_pct, true))}\\)`,
    );
  }
  return lines;
}

function sizeBadge(usdValue: number): string {
  if (usdValue >= 10_000_000) return '🐋🐋🐋';
  if (usdValue >= 1_000_000) return '🐋🐋';
  return '🐋';
}

/** Buckets a size so the teaser hints at scale without revealing the trade. */
function sizeBucket(value: number): string {
  if (value >= 10_000_000) return '$10M+';
  if (value >= 5_000_000) return '$5M+';
  if (value >= 1_000_000) return '$1M+';
  if (value >= 500_000) return '$500K+';
  if (value >= 250_000) return '$250K+';
  return '$100K+';
}

/**
 * Renders the censored version of a VIP-tier alert for the free channel: the
 * signal type and scale are visible, the token, wallets and price are not.
 */
export function renderTeaser(alert: Alert, opts: { dashboardUrl: string; priceUsd: number }): string {
  const headline =
    alert.kind === 'accumulation'
      ? '📈 ACCUMULATION SIGNAL'
      : (DIRECTION_HEADLINE[alert.direction] ?? '🐋 WHALE TRANSFER');

  const lines = [
    `${sizeBadge(alert.amount_usd)} *${esc(headline)}* 🔒`,
    '',
    `*Chain:* ${CHAIN_EMOJI[alert.chain_id] ?? ''} ${esc(alert.chain)}`,
    `*Token:* ${esc('•••••')} \\(VIP\\)`,
    `*Size:* ${esc(sizeBucket(alert.amount_usd))}`,
  ];

  if (alert.verdict) {
    lines.push(
      `*24h read:* ${verdictBadge(alert.score)} ${esc(alert.verdict)} \\(${esc(alert.score.toFixed(0))}/100\\)`,
    );
  }
  if (alert.smart_wallets_24h >= 2) {
    lines.push(`🧠 *Cluster:* ${esc(alert.smart_wallets_24h)} akıllı cüzdan aynı tokeni topluyor`);
  }
  // Risk flags stay visible in the teaser: a warning is worth more to a free
  // reader than the trade details we are holding back.
  if (alert.liquidity_warning) {
    lines.push(esc('⚠️ Likidite oranı yüksek — bu işlem fiyatı sert oynatabilir'));
  }
  if (alert.wash_risk) {
    lines.push(`🚨 *${esc('MANİPÜLASYON: YAPAY HACİM YARATMA')}*`);
  }

  lines.push(
    '',
    esc('Token, cüzdanlar ve giriş fiyatı VIP üyelere açık.'),
    `🔓 [${esc(`VIP üyeliği — $${opts.priceUsd.toFixed(2)}/ay`)}](${opts.dashboardUrl}/vip)`,
  );
  return lines.join('\n');
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
