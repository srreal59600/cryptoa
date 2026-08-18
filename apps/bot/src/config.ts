export interface BotConfig {
  token: string;
  redisUrl: string;
  postgresDsn: string;
  vipChannelId?: string;
  freeChannelId?: string;
  /** Free channel band lower bound (inclusive). */
  freeChannelMinUsd: number;
  /** VIP threshold: at or above it alerts go to VIP only, below it to the free channel. */
  vipChannelMinUsd: number;
  /** Optional extra delay before posting to the free channel. */
  freeDelaySeconds: number;
  /** Minimum spacing between two channel posts (Telegram allows ~20/min). */
  channelIntervalMs: number;
  /** Per-channel backlog before the smallest alerts get dropped. */
  channelQueueSize: number;
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
    freeChannelMinUsd: num(process.env.FREE_CHANNEL_MIN_USD, 50_000),
    vipChannelMinUsd: num(process.env.ALERT_USD, 100_000),
    freeDelaySeconds: num(process.env.FREE_DELAY_SECONDS, 0),
    channelIntervalMs: num(process.env.CHANNEL_INTERVAL_MS, 4_000),
    channelQueueSize: num(process.env.CHANNEL_QUEUE_SIZE, 25),
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
