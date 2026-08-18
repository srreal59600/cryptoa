import Redis from 'ioredis';
import { Telegraf } from 'telegraf';

import type { BotConfig } from './config';
import type { Database } from './db';
import { renderAlert } from './format';
import { RateLimitedSender } from './sender';
import type { Alert } from './types';

const ALERT_CHANNEL = 'whaleradar:alerts';

/**
 * Consumes alerts published by the Go listener and fans them out:
 *  - VIP channel + VIP direct messages: alerts at or above the VIP threshold
 *  - Free channel: the smaller [freeChannelMinUsd, vipChannelMinUsd) band
 */
export class AlertDispatcher {
  private readonly sub: Redis;
  private readonly channels: RateLimitedSender;
  private readonly dms: RateLimitedSender;

  constructor(
    bot: Telegraf,
    private readonly db: Database,
    private readonly cfg: BotConfig,
  ) {
    this.sub = new Redis(cfg.redisUrl, { maxRetriesPerRequest: null });
    this.channels = new RateLimitedSender(bot, {
      intervalMs: cfg.channelIntervalMs,
      maxQueue: cfg.channelQueueSize,
    });
    this.dms = new RateLimitedSender(bot, { intervalMs: 1_000, maxQueue: 50 });
  }

  async start(): Promise<void> {
    await this.sub.subscribe(ALERT_CHANNEL);
    this.sub.on('message', (_channel, payload) => {
      let alert: Alert;
      try {
        alert = JSON.parse(payload) as Alert;
      } catch (err) {
        console.error('dropping malformed alert', err);
        return;
      }
      void this.handle(alert).catch((err) => console.error('alert dispatch failed', err));
    });
    console.log(`alert dispatcher subscribed to ${ALERT_CHANNEL}`);
  }

  async stop(): Promise<void> {
    await this.sub.quit();
  }

  private async handle(alert: Alert): Promise<void> {
    const vipText = renderAlert(alert, { dashboardUrl: this.cfg.dashboardUrl, tier: 'vip' });

    if (alert.amount_usd >= this.cfg.vipChannelMinUsd) {
      if (this.cfg.vipChannelId) {
        this.channels.enqueue(this.cfg.vipChannelId, vipText, alert.amount_usd);
      }
      await this.fanoutToVipUsers(alert, vipText);
      return;
    }

    if (this.cfg.freeChannelId && alert.amount_usd >= this.cfg.freeChannelMinUsd) {
      const freeText = renderAlert(alert, {
        dashboardUrl: this.cfg.dashboardUrl,
        tier: 'free',
        vipMinUsd: this.cfg.vipChannelMinUsd,
      });
      const chatId = this.cfg.freeChannelId;
      if (this.cfg.freeDelaySeconds > 0) {
        setTimeout(
          () => this.channels.enqueue(chatId, freeText, alert.amount_usd),
          this.cfg.freeDelaySeconds * 1000,
        );
      } else {
        this.channels.enqueue(chatId, freeText, alert.amount_usd);
      }
    }
  }

  private async fanoutToVipUsers(alert: Alert, text: string): Promise<void> {
    const [users, watchIndex] = await Promise.all([this.db.activeVipUsers(), this.db.watchIndex()]);
    const involved = [alert.token, alert.from, alert.to]
      .filter(Boolean)
      .map((a) => a.toLowerCase());

    for (const user of users) {
      const watched = watchIndex.get(Number(user.telegram_id));
      const isWatched = watched ? involved.some((a) => watched.has(a)) : false;
      const chains = user.chains ?? [];

      if (!isWatched) {
        if (alert.amount_usd < Number(user.min_usd)) continue;
        if (chains.length > 0 && !chains.includes(alert.chain_id)) continue;
      }
      // delivered_alerts doubles as the de-duplication guard across restarts.
      if (!(await this.db.recordDelivery(alert.id, Number(user.telegram_id)))) continue;

      this.dms.enqueue(String(user.telegram_id), text, alert.amount_usd);
    }
  }
}
