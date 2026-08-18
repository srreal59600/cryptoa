import { Pool } from 'pg';

import type { BotUser, WatchItem } from './types';

export class Database {
  private readonly pool: Pool;

  constructor(dsn: string) {
    this.pool = new Pool({ connectionString: dsn, max: 10 });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  /** Creates the user on first contact and returns the current record. */
  async upsertUser(
    telegramId: number,
    username: string | undefined,
    firstName: string | undefined,
    defaultMinUsd: number,
  ): Promise<BotUser> {
    const { rows } = await this.pool.query<BotUser>(
      `INSERT INTO bot_users (telegram_id, username, first_name, min_usd)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (telegram_id) DO UPDATE
         SET username = EXCLUDED.username,
             first_name = EXCLUDED.first_name,
             updated_at = now()
       RETURNING telegram_id, username, tier, vip_expires_at, min_usd, chains, muted`,
      [telegramId, username ?? null, firstName ?? null, defaultMinUsd],
    );
    return rows[0];
  }

  async getUser(telegramId: number): Promise<BotUser | null> {
    const { rows } = await this.pool.query<BotUser>(
      `SELECT telegram_id, username, tier, vip_expires_at, min_usd, chains, muted
       FROM bot_users WHERE telegram_id = $1`,
      [telegramId],
    );
    return rows[0] ?? null;
  }

  /** Active VIPs eligible for direct-message delivery. */
  async activeVipUsers(): Promise<BotUser[]> {
    const { rows } = await this.pool.query<BotUser>(
      `SELECT telegram_id, username, tier, vip_expires_at, min_usd, chains, muted
       FROM bot_users
       WHERE tier = 'vip'
         AND muted = false
         AND (vip_expires_at IS NULL OR vip_expires_at > now())`,
    );
    return rows;
  }

  async allUserIds(): Promise<number[]> {
    const { rows } = await this.pool.query<{ telegram_id: number }>(
      'SELECT telegram_id FROM bot_users WHERE muted = false',
    );
    return rows.map((r) => Number(r.telegram_id));
  }

  async setTier(telegramId: number, tier: 'free' | 'vip', days?: number): Promise<void> {
    await this.pool.query(
      `UPDATE bot_users
       SET tier = $2,
           vip_expires_at = CASE WHEN $3::int IS NULL THEN NULL ELSE now() + make_interval(days => $3::int) END,
           updated_at = now()
       WHERE telegram_id = $1`,
      [telegramId, tier, days ?? null],
    );
  }

  async setMinUsd(telegramId: number, minUsd: number): Promise<void> {
    await this.pool.query(
      'UPDATE bot_users SET min_usd = $2, updated_at = now() WHERE telegram_id = $1',
      [telegramId, minUsd],
    );
  }

  async setMuted(telegramId: number, muted: boolean): Promise<void> {
    await this.pool.query(
      'UPDATE bot_users SET muted = $2, updated_at = now() WHERE telegram_id = $1',
      [telegramId, muted],
    );
  }

  async addWatch(
    telegramId: number,
    chainId: number,
    kind: 'token' | 'wallet',
    address: string,
    label = '',
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO watchlist (telegram_id, chain_id, kind, address, label)
       VALUES ($1, $2, $3, lower($4), $5)
       ON CONFLICT (telegram_id, chain_id, kind, address) DO NOTHING`,
      [telegramId, chainId, kind, address, label],
    );
  }

  async removeWatch(telegramId: number, address: string): Promise<number> {
    const res = await this.pool.query(
      'DELETE FROM watchlist WHERE telegram_id = $1 AND address = lower($2)',
      [telegramId, address],
    );
    return res.rowCount ?? 0;
  }

  async listWatch(telegramId: number): Promise<WatchItem[]> {
    const { rows } = await this.pool.query<WatchItem>(
      'SELECT chain_id, kind, address, label FROM watchlist WHERE telegram_id = $1 ORDER BY created_at',
      [telegramId],
    );
    return rows;
  }

  /** Watchlist entries of every VIP, used to force-deliver tracked addresses. */
  async watchIndex(): Promise<Map<number, Set<string>>> {
    const { rows } = await this.pool.query<{ telegram_id: number; address: string }>(
      'SELECT telegram_id, address FROM watchlist',
    );
    const index = new Map<number, Set<string>>();
    for (const row of rows) {
      const id = Number(row.telegram_id);
      if (!index.has(id)) index.set(id, new Set());
      index.get(id)!.add(row.address.toLowerCase());
    }
    return index;
  }

  async topScores(limit = 10, chainId?: number) {
    const { rows } = await this.pool.query(
      `SELECT chain_id, token, symbol, score, net_accum_usd, dex_buy_usd, dex_sell_usd,
              cex_outflow_usd, cex_inflow_usd, whale_tx_count
       FROM token_scores
       WHERE ($2::bigint IS NULL OR chain_id = $2::bigint)
       ORDER BY score DESC, net_accum_usd DESC
       LIMIT $1`,
      [limit, chainId ?? null],
    );
    return rows;
  }

  async tokenSummary(address: string) {
    const { rows } = await this.pool.query(
      `SELECT s.chain_id, s.token, s.symbol, s.score, s.net_accum_usd, s.dex_buy_usd, s.dex_sell_usd,
              s.cex_inflow_usd, s.cex_outflow_usd, s.whale_tx_count, s.computed_at
       FROM token_scores s
       WHERE lower(s.token) = lower($1) OR upper(s.symbol) = upper($1)
       ORDER BY s.score DESC
       LIMIT 1`,
      [address],
    );
    return rows[0] ?? null;
  }

  async walletActivity(address: string, limit = 10) {
    const { rows } = await this.pool.query(
      `SELECT chain_id, token_symbol, direction, amount_usd, tx_hash, seen_at
       FROM transfers
       WHERE lower(from_address) = lower($1) OR lower(to_address) = lower($1)
       ORDER BY seen_at DESC
       LIMIT $2`,
      [address, limit],
    );
    return rows;
  }

  async platformStats() {
    const { rows } = await this.pool.query(
      `SELECT
         (SELECT count(*) FROM transfers WHERE seen_at >= now() - interval '24 hours')      AS transfers_24h,
         (SELECT COALESCE(SUM(amount_usd),0) FROM transfers WHERE seen_at >= now() - interval '24 hours') AS volume_24h,
         (SELECT count(*) FROM pools WHERE created_at >= now() - interval '24 hours')       AS pools_24h,
         (SELECT count(*) FROM bot_users)                                                   AS users,
         (SELECT count(*) FROM bot_users WHERE tier = 'vip')                                AS vip_users`,
    );
    return rows[0];
  }

  async recordDelivery(alertId: string, telegramId: number): Promise<boolean> {
    const res = await this.pool.query(
      `INSERT INTO delivered_alerts (alert_id, telegram_id) VALUES ($1, $2)
       ON CONFLICT (alert_id, telegram_id) DO NOTHING`,
      [alertId, telegramId],
    );
    return (res.rowCount ?? 0) > 0;
  }

  async createPayment(telegramId: number, plan: string, amountUsd: number, txHash: string) {
    await this.pool.query(
      `INSERT INTO payments (telegram_id, plan, amount_usd, tx_hash, status)
       VALUES ($1, $2, $3, $4, 'pending')`,
      [telegramId, plan, amountUsd, txHash],
    );
  }
}
