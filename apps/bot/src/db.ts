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

  /**
   * Erases the personal data we hold for a user: profile, watchlist and web
   * sessions. Paid invoices stay for accounting, with the profile row gone.
   */
  async deleteUser(telegramId: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM watchlist WHERE telegram_id = $1', [telegramId]);
      await client.query('DELETE FROM web_sessions WHERE telegram_id = $1', [telegramId]);
      await client.query('DELETE FROM bot_users WHERE telegram_id = $1', [telegramId]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
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
       ON CONFLICT (telegram_id, chain_id, kind, address)
       DO UPDATE SET label = COALESCE(NULLIF(EXCLUDED.label, ''), watchlist.label)`,
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

  /**
   * Watchlist entries of every VIP, keyed by user then address, with the
   * nickname the user gave that address (empty string when unnamed).
   */
  async watchIndex(): Promise<Map<number, Map<string, string>>> {
    const { rows } = await this.pool.query<{ telegram_id: number; address: string; label: string | null }>(
      'SELECT telegram_id, address, label FROM watchlist',
    );
    const index = new Map<number, Map<string, string>>();
    for (const row of rows) {
      const id = Number(row.telegram_id);
      if (!index.has(id)) index.set(id, new Map());
      index.get(id)!.set(row.address.toLowerCase(), row.label ?? '');
    }
    return index;
  }

  /** Renames a watchlist entry; returns false when the user does not track it. */
  async setWatchLabel(telegramId: number, address: string, label: string): Promise<boolean> {
    const res = await this.pool.query(
      'UPDATE watchlist SET label = $3 WHERE telegram_id = $1 AND address = lower($2)',
      [telegramId, address, label],
    );
    return (res.rowCount ?? 0) > 0;
  }

  /** Biggest tracked accounts with their measured window result. */
  async whaleAccounts(limit = 10) {
    const { rows } = await this.pool.query(
      `SELECT chain_id, address, volume_usd, tx_count, tokens, pnl_usd, pnl_pct, last_seen
       FROM whale_accounts ORDER BY volume_usd DESC LIMIT $1`,
      [limit],
    );
    return rows;
  }

  /**
   * 30-day mark-to-market result of one wallet: everything it accumulated in
   * the window valued at the latest observed price. Positions closed inside
   * the window are not netted out, so this is an estimate of its entries.
   */
  async walletPnl(address: string, days = 30) {
    const { rows } = await this.pool.query(
      `WITH latest AS (
         SELECT DISTINCT ON (chain_id, token) chain_id, token, price_usd
         FROM transfers
         WHERE price_usd > 0 AND seen_at >= now() - interval '48 hours'
         ORDER BY chain_id, token, seen_at DESC
       )
       SELECT COALESCE(SUM(t.amount_usd), 0)           AS cost_usd,
              COALESCE(SUM(t.amount * l.price_usd), 0) AS value_usd,
              count(*)::int                            AS buys,
              count(DISTINCT t.token)::int             AS tokens
       FROM transfers t
       JOIN latest l ON l.chain_id = t.chain_id AND l.token = t.token
       WHERE lower(t.to_address) = lower($1)
         AND t.direction IN ('dex_buy','cex_withdrawal')
         AND t.price_usd > 0
         AND t.seen_at >= now() - make_interval(days => $2)`,
      [address, days],
    );
    return rows[0] as { cost_usd: number; value_usd: number; buys: number; tokens: number };
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

  /** Track record of published alerts per holding period. */
  async performance(days = 30): Promise<
    { horizon: string; samples: number; win_rate: number; avg_return: number; best: number; worst: number }[]
  > {
    const horizons: [string, string][] = [
      ['1h', 'ret_1h'],
      ['4h', 'ret_4h'],
      ['24h', 'ret_24h'],
    ];
    const out = [];
    for (const [horizon, column] of horizons) {
      const { rows } = await this.pool.query(
        `SELECT count(${column})::int AS samples,
                COALESCE(AVG((${column} > 0)::int::float8), 0) AS win_rate,
                COALESCE(AVG(${column}), 0) AS avg_return,
                COALESCE(MAX(${column}), 0) AS best,
                COALESCE(MIN(${column}), 0) AS worst
         FROM alert_outcomes
         WHERE created_at >= now() - make_interval(days => $1)`,
        [days],
      );
      out.push({ horizon, ...rows[0] });
    }
    return out;
  }

  /** Wallets with the strongest realised 24h forward returns. */
  async smartWallets(limit = 10) {
    const { rows } = await this.pool.query(
      `SELECT chain_id, address, trades, wins, avg_ret_24h, score
       FROM wallet_scores
       WHERE trades >= 3
       ORDER BY score DESC, trades DESC
       LIMIT $1`,
      [limit],
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
