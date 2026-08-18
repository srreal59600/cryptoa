export interface BotConfig {
  token: string;
  redisUrl: string;
  postgresDsn: string;
  vipChannelId?: string;
  freeChannelId?: string;
  /** Free channel only receives alerts at or above this size... */
  freeChannelUsd: number;
  /** ...and only after this delay, so VIP keeps its edge. */
  freeDelaySeconds: number;
  /** Default DM threshold for VIP subscribers. */
  defaultMinUsd: number;
  adminIds: number[];
  vipPriceUsd: number;
  vipPaymentAddress: string;
  dashboardUrl: string;
}

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && value !== undefined && value !== '' ? parsed : fallback;
}

export function loadConfig(): BotConfig {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN is required');
  }

  return {
    token,
    redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379/0',
    postgresDsn:
      process.env.POSTGRES_DSN ??
      'postgres://whaleradar:whaleradar@localhost:5432/whaleradar?sslmode=disable',
    vipChannelId: process.env.TELEGRAM_VIP_CHANNEL_ID,
    freeChannelId: process.env.TELEGRAM_FREE_CHANNEL_ID,
    freeChannelUsd: num(process.env.FREE_CHANNEL_USD, 1_000_000),
    freeDelaySeconds: num(process.env.FREE_DELAY_SECONDS, 900),
    defaultMinUsd: num(process.env.ALERT_USD, 100_000),
    adminIds: (process.env.TELEGRAM_ADMIN_IDS ?? '')
      .split(',')
      .map((v) => Number(v.trim()))
      .filter((v) => Number.isFinite(v) && v > 0),
    vipPriceUsd: num(process.env.VIP_PRICE_USD, 99),
    vipPaymentAddress: process.env.VIP_PAYMENT_ADDRESS ?? '',
    dashboardUrl: process.env.DASHBOARD_URL ?? 'http://localhost:3000',
  };
}
