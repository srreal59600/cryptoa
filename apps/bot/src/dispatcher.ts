import Redis from 'ioredis';
import { Telegraf } from 'telegraf';

import type { BotConfig } from './config';
import type { Database } from './db';
import { esc, renderAlert, renderTeaser, short } from './format';
import { RateLimitedSender } from './sender';
import type { Alert } from './types';

const ALERT_CHANNEL = 'whaleradar:alerts';

/**
 * Consumes alerts published by the Go listener and fans them out:
 *  - VIP channel: alerts at or above the VIP threshold, in full
 *  - Free channel: the smaller [freeChannelMinUsd, vipChannelMinUsd) band in
 *    full, plus a censored teaser of every VIP-tier alert
 *
 * Direct messages are opt-in only: a VIP user is DM'd when the alert touches an
 * address or token on their /watch list, never for the general feed.
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
      this.sendToFree(
        renderTeaser(alert, {
          dashboardUrl: this.cfg.dashboardUrl,
          priceUsd: this.cfg.vipPriceUsd,
        }),
        alert.amount_usd,
      );
      await this.fanoutToWatchers(alert, vipText);
      return;
    }

    if (alert.amount_usd >= this.cfg.freeChannelMinUsd) {
      this.sendToFree(
        renderAlert(alert, {
          dashboardUrl: this.cfg.dashboardUrl,
          tier: 'free',
          vipMinUsd: this.cfg.vipChannelMinUsd,
        }),
        alert.amount_usd,
      );
    }

    // Tracked accounts are followed move by move, so their watchers hear about
    // the smaller transfers the channels never see.
    await this.fanoutToWatchers(alert, vipText);
  }

  private sendToFree(text: string, priority: number): void {
    const chatId = this.cfg.freeChannelId;
    if (!chatId) return;
    if (this.cfg.freeDelaySeconds > 0) {
      setTimeout(
        () => this.channels.enqueue(chatId, text, priority),
        this.cfg.freeDelaySeconds * 1000,
      );
      return;
    }
    this.channels.enqueue(chatId, text, priority);
  }

  private async fanoutToWatchers(alert: Alert, text: string): Promise<void> {
    const [users, watchIndex] = await Promise.all([this.db.activeVipUsers(), this.db.watchIndex()]);
    const involved = [alert.token, alert.from, alert.to]
      .filter(Boolean)
      .map((a) => a.toLowerCase());

    for (const user of users) {
      const watched = watchIndex.get(Number(user.telegram_id));
      if (!watched) continue;
      const hit = involved.find((a) => watched.has(a));
      if (!hit) continue;
      if (alert.amount_usd < Number(user.min_usd)) continue;
      // delivered_alerts doubles as the de-duplication guard across restarts.
      if (!(await this.db.recordDelivery(alert.id, Number(user.telegram_id)))) continue;

      const alias = watched.get(hit) || short(hit);
      const header = `👤 *${esc(alias)}* takip listendeki hesap hareket etti\n\n`;
      this.dms.enqueue(String(user.telegram_id), header + text, alert.amount_usd);
    }
  }
}
